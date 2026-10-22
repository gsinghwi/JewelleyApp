/* JewelleryApp - live gold / silver / platinum rates from the internet
 *
 * Provider IBJA (default): India Bullion and Jewellers Association benchmark rates (the rates most
 *   Indian jewellers quote), read from a free community service that republishes ibjarates.com
 *   (https://github.com/0xSaurabhx/IBJA-API, unofficial). IBJA rates already include import duty and
 *   exclude GST. Units are detected (gold per gram or per 10 g, silver per gram or per kg). Purities IBJA
 *   does not publish (20K, silver 925, platinum 950) are derived from the 999 rate by fineness.
 *   If IBJA cannot be reached, the AUTO calculation below is used instead.
 *
 * Provider AUTO (free, no API key):
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
  const IBJA_DEFAULT = 'https://ibja-api.vercel.app';
  // IBJA field -> purity code, and the plausible rupees-per-gram range used to detect units
  const IBJA_GOLD = { lblGold999: 'G24K', lblGold916: 'G22K', lblGold750: 'G18K', lblGold585: 'G14K' };
  const RANGE = { GOLD: [2000, 80000], SILVER: [20, 2000], PLATINUM: [1000, 40000] };

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
        provider: s.liveProvider || 'IBJA', url: s.rateApiUrl || '', ibjaUrl: (s.ibjaUrl || IBJA_DEFAULT).replace(/\/+$/, ''),
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

    /* A published rate converted to rupees per gram: pick the unit (per g / 10 g / kg) that puts it
     * closest to today's rate for that purity, or inside the plausible range when there is none. */
    perGram(value, metal, ref) {
      const divisors = metal === 'SILVER' ? [1, 1000] : [1, 10];
      const [lo, hi] = RANGE[metal];
      const target = ref > 0 ? ref : Math.sqrt(lo * hi);
      let best = null;
      divisors.forEach((d) => {
        const v = value / d;
        const score = Math.abs(Math.log(v / target));
        if (v >= lo && v <= hi && (!best || score < best.score)) best = { v, d, score };
      });
      return best;
    },

    async ibja(cfg) {
      const base = cfg.ibjaUrl;
      const prev = DB.currentRates();
      const pick = (j, key) => {
        const pm = +String(j[key + '_PM'] || '').replace(/,/g, '');
        const am = +String(j[key + '_AM'] || '').replace(/,/g, '');
        return pm > 0 ? { v: pm, session: 'PM' } : am > 0 ? { v: am, session: 'AM' } : null;
      };
      const gold = await getJSON(base + '/latest');
      const raw = {}, warnings = [];
      let session = '';
      Object.keys(IBJA_GOLD).forEach((k) => { const r = pick(gold, k); if (r) { raw[IBJA_GOLD[k]] = r.v; session = session || r.session; } });
      if (!raw.G24K) throw new Error('IBJA feed returned no 24K (999) gold rate');
      const extra = [['SILVER', '/silver/latest', 'lblSilver999', 'S999'], ['PLATINUM', '/platinum/latest', 'lblPlatinum999', 'PT999']];
      for (const [metal, path, key, code] of extra) {
        try { const r = pick(await getJSON(base + path), key); if (r) raw[code] = r.v; else warnings.push(metal + ': no rate published'); } catch (e) { warnings.push(metal + ': ' + e.message); }
      }
      // Convert to per gram
      const g999 = LiveRates.perGram(raw.G24K, 'GOLD', prev.G24K);
      if (!g999) throw new Error('IBJA gold rate ' + raw.G24K + ' does not look like a valid rate');
      const base999 = { GOLD: g999.v };
      const unit = { GOLD: g999.d === 10 ? 'per 10 g' : 'per g' };
      if (raw.S999) { const s = LiveRates.perGram(raw.S999, 'SILVER', prev.S999); if (s) { base999.SILVER = s.v; unit.SILVER = s.d === 1000 ? 'per kg' : 'per g'; } else warnings.push('Silver rate looks invalid'); }
      if (raw.PT999) { const p = LiveRates.perGram(raw.PT999, 'PLATINUM', prev.PT950 ? prev.PT950 * 999 / 950 : 0); if (p) { base999.PLATINUM = p.v; unit.PLATINUM = p.d === 10 ? 'per 10 g' : 'per g'; } else warnings.push('Platinum rate looks invalid'); }
      const values = {}, lines = [];
      const prem = 1 + cfg.premiumPct / 100;
      DB.all('purities').forEach((p) => {
        let ibjaRate = null, derived = false;
        if (p.metalId === 'GOLD' && raw[p.id]) ibjaRate = raw[p.id] / g999.d;
        else if (base999[p.metalId]) { ibjaRate = base999[p.metalId] * p.fineness / 999; derived = true; }
        if (!ibjaRate) return;
        const rate = ibjaRate * prem;
        values[p.id] = p.metalId === 'SILVER' ? Math.round(rate * 100) / 100 : Math.round(rate);
        lines.push({ purity: p.name, spotPerGram: ibjaRate, duty: null, derived, premium: cfg.premiumPct, rate: values[p.id] });
      });
      return {
        values, lines, warnings, basis: 'IBJA',
        source: 'IBJA ' + (gold.date ? U.fmtDate(gold.date) + ' ' : '') + session + ' (via ' + new URL(base).host + ')',
        spotAt: gold.date || '', units: unit,
      };
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
      } else if (cfg.provider === 'IBJA') {
        try {
          result = await LiveRates.ibja(cfg);
        } catch (e) {
          // IBJA unavailable: fall back to the international price calculation
          const sp = await LiveRates.spot();
          const ind = LiveRates.toIndian(sp.perOz, cfg);
          result = { values: ind.values, lines: ind.lines, source: sp.source + ' (IBJA unavailable)', spotAt: sp.at, usdInr: sp.usdInr, warnings: ['IBJA: ' + e.message].concat(sp.warnings || []) };
        }
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
