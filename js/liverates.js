/* JewelleryApp - live gold / silver / platinum rates from the internet
 *
 * Provider AUTO (default, free, no API key):
 *   1. International spot price per troy ounce in USD from gold-api.com, converted to INR with
 *      the day's USD/INR rate (fawazahmed0 currency API, jsDelivr CDN with a Cloudflare mirror).
 *   2. If that fails: the currency API's own XAU / XAG / XPT -> INR prices (updated daily).
 *   Indian market rate per gram = spot INR per gram x fineness/1000 x (1 + import duty %) x (1 + premium %)
 *   GST (3%) is not included: it is added on the bill, as with published Indian rates.
 *
 * Provider CUSTOM: any URL returning JSON with rates per gram keyed by purity code, e.g.
 *   {"G24K": 12850, "G22K": 11780, "S999": 165}   (also accepted under "rates" or "data")
 */
(function (global) {
  'use strict';

  const TROY_OZ_G = 31.1034768;
  const METAL_SYMBOL = { GOLD: 'XAU', SILVER: 'XAG', PLATINUM: 'XPT' };
  const CURRENCY_API = [
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/',
    'https://latest.currency-api.pages.dev/v1/currencies/',
  ];
  const GOLD_API = 'https://api.gold-api.com/price/';

  async function getJSON(url, ms) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), ms || 12000);
    try {
      const res = await fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + new URL(url).host);
      return await res.json();
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'Timed out reaching ' + new URL(url).host : e.message);
    } finally {
      clearTimeout(timer);
    }
  }

  // Currency API: value of 1 unit of `base` in INR (tries the CDN, then the mirror)
  async function currencyToInr(base) {
    let lastErr;
    for (const root of CURRENCY_API) {
      try {
        const j = await getJSON(root + base + '.min.json');
        const v = j && j[base] && +j[base].inr;
        if (v > 0) return { inr: v, date: j.date || '' };
        throw new Error('No INR value for ' + base.toUpperCase());
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  const LiveRates = {
    TROY_OZ_G,

    settings() {
      const s = DB.settings;
      return {
        provider: s.liveProvider || 'AUTO', url: s.rateApiUrl || '',
        duty: { GOLD: U.n(s.liveDutyGold), SILVER: U.n(s.liveDutySilver), PLATINUM: U.n(s.liveDutyPlatinum) },
        premiumPct: U.n(s.livePremiumPct), autoMins: U.n(s.liveAutoMins),
      };
    },

    /* International spot prices in INR per troy ounce for each metal */
    async spot() {
      const errors = [];
      // 1. Live spot in USD x USD/INR
      try {
        const fx = await currencyToInr('usd');
        const out = { perOz: {}, usdInr: fx.inr, source: 'gold-api.com spot (USD) x USD/INR ' + U.num(fx.inr, 2), at: '' };
        for (const metal of Object.keys(METAL_SYMBOL)) {
          try {
            const j = await getJSON(GOLD_API + METAL_SYMBOL[metal]);
            if (+j.price > 0) {
              out.perOz[metal] = +j.price * fx.inr;
              out.at = out.at || j.updatedAt || '';
            }
          } catch (e) { errors.push(metal + ': ' + e.message); }
        }
        if (out.perOz.GOLD) return Object.assign(out, { warnings: errors });
      } catch (e) { errors.push('USD/INR: ' + e.message); }
      // 2. Daily XAU / XAG / XPT -> INR
      const out = { perOz: {}, source: 'Daily metal prices (currency API)', at: '' };
      for (const metal of Object.keys(METAL_SYMBOL)) {
        try {
          const r = await currencyToInr(METAL_SYMBOL[metal].toLowerCase());
          out.perOz[metal] = r.inr;
          out.at = out.at || r.date;
        } catch (e) { errors.push(metal + ' (daily): ' + e.message); }
      }
      if (out.perOz.GOLD) return Object.assign(out, { warnings: errors });
      console.warn('Live rate sources failed:', errors);
      throw new Error('Could not reach the rate websites. Check the internet connection and try again.');
    },

    /* Indian market rate per gram for every purity, from spot INR per troy ounce */
    toIndian(perOz, cfg) {
      const values = {}, lines = [];
      DB.all('purities').forEach((p) => {
        const oz = perOz[p.metalId];
        if (!oz) return;
        const perGramFine = oz / TROY_OZ_G;
        const duty = U.n(cfg.duty[p.metalId]);
        const rate = perGramFine * (p.fineness / 1000) * (1 + duty / 100) * (1 + cfg.premiumPct / 100);
        values[p.id] = p.metalId === 'GOLD' || p.metalId === 'PLATINUM' ? Math.round(rate) : Math.round(rate * 100) / 100;
        lines.push({ purity: p.name, spotPerGram: perGramFine * (p.fineness / 1000), duty, premium: cfg.premiumPct, rate: values[p.id] });
      });
      return { values, lines };
    },

    async custom(url) {
      if (!url) throw new Error('Enter the rate feed URL in Live rate settings');
      const j = await getJSON(url);
      const src = j && (j.rates || j.data || j);
      const values = {};
      DB.all('purities').forEach((p) => { if (+src[p.id] > 0) values[p.id] = +src[p.id]; });
      if (!Object.keys(values).length) throw new Error('The feed returned no rates with purity codes such as G24K, G22K, S999');
      return { values, source: 'Custom feed ' + new URL(url).host, lines: [] };
    },

    /* Fetch and, unless preview, save as a new rate entry. Metals the source did not return keep their last rate. */
    async refresh(opts) {
      opts = opts || {};
      const cfg = LiveRates.settings();
      let result;
      if (cfg.provider === 'CUSTOM') {
        result = await LiveRates.custom(cfg.url);
      } else {
        const sp = await LiveRates.spot();
        const ind = LiveRates.toIndian(sp.perOz, cfg);
        result = { values: ind.values, lines: ind.lines, source: sp.source, spotAt: sp.at, usdInr: sp.usdInr, warnings: sp.warnings || [] };
      }
      const prev = DB.currentRates();
      const values = Object.assign({}, prev, result.values);
      const changed = Object.keys(values).some((k) => values[k] !== prev[k]);
      if (!opts.preview && (changed || opts.force)) {
        DB.insert('rates', {
          at: new Date().toISOString(), values, source: 'Live: ' + result.source,
          by: Auth.user ? Auth.user.username : 'auto',
          detail: { spotAt: result.spotAt || '', usdInr: result.usdInr || '', duty: cfg.duty, premiumPct: cfg.premiumPct, updated: Object.keys(result.values) },
        });
      }
      return Object.assign(result, { values, changed });
    },

    // While the app is open, refresh automatically every N minutes (head office Admin/Manager only)
    timer: null,
    startAuto() {
      clearInterval(LiveRates.timer);
      const mins = LiveRates.settings().autoMins;
      if (!(mins > 0) || !Auth.user || !Auth.can(['Admin', 'Manager']) || !Branch.isMaster()) return;
      const tick = async () => {
        const last = DB.latestRate();
        if (last.at && Date.now() - new Date(last.at).getTime() < mins * 60000 * 0.9) return;
        try {
          const r = await LiveRates.refresh();
          if (r.changed) { UI.toast('Live rates updated: 24K ' + U.inr(r.values.G24K, { whole: true }) + '/g'); App.updateTicker(); }
        } catch (e) { /* stay quiet; manual refresh shows errors */ }
      };
      tick();
      LiveRates.timer = setInterval(tick, Math.max(1, mins) * 60000);
    },
    stopAuto() { clearInterval(LiveRates.timer); },
  };

  global.LiveRates = LiveRates;
})(window);
