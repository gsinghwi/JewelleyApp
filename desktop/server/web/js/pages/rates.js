/* Rates: daily metal rates per gram used for billing, with history */
(function () {
  'use strict';
  const esc = U.esc;

  function lineChart(history, key) {
    const pts = history.slice(-30).filter((h) => h.values[key]);
    if (pts.length < 2) return '<p class="muted">Not enough history to chart yet.</p>';
    const w = 560, h = 170, pad = 34;
    const vals = pts.map((p) => p.values[key]);
    const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
    const x = (i) => pad + (i * (w - pad * 2)) / (pts.length - 1);
    const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2);
    const path = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.values[key]).toFixed(1)).join(' ');
    const dots = pts.map((p, i) => '<circle cx="' + x(i) + '" cy="' + y(p.values[key]) + '" r="3.5" class="dot"><title>' +
      U.fmtDateTime(p.at) + ': ' + U.inr(p.values[key], { whole: true }) + '</title></circle>').join('');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="chart" role="img" aria-label="Rate trend">' +
      '<text x="4" y="' + (y(max) + 4) + '" class="axis">' + U.inr(max, { whole: true }) + '</text>' +
      '<text x="4" y="' + (y(min) + 4) + '" class="axis">' + U.inr(min, { whole: true }) + '</text>' +
      '<path d="' + path + '" class="line"/>' + dots +
      '<text x="' + pad + '" y="' + (h - 8) + '" class="axis">' + U.fmtDate(pts[0].at) + '</text>' +
      '<text x="' + (w - pad) + '" y="' + (h - 8) + '" text-anchor="end" class="axis">' + U.fmtDate(pts[pts.length - 1].at) + '</text></svg>';
  }

  let lastLive = null; // breakdown of the most recent live refresh, shown under the form
  let pending = null; // fetched live rates waiting for review (not saved yet)

  function liveDetail(r) {
    if (!r) return '';
    return '<div class="live-detail"><div class="card-head"><h3>How the live rates were worked out</h3><small class="muted">' + esc(U.fmtDateTime(r.fetchedAt)) + '</small></div>' +
      '<p class="small">Source: <b>' + esc(r.source) + '</b>' + (r.spotAt && r.basis !== 'IBJA' ? ' &middot; price time ' + esc(U.fmtDateTime(r.spotAt)) : '') +
      (r.units ? ' &middot; published ' + esc(Object.keys(r.units).map((m) => m.toLowerCase() + ' ' + r.units[m]).join(', ')) : '') + '</p>' +
      (r.lines.length ? UI.table({
        columns: [
          { label: 'Purity', key: 'purity' },
          { label: r.basis === 'IBJA' ? 'IBJA rate \u20B9/g' : 'International \u20B9/g', align: 'right', render: (l) => U.num(l.spotPerGram, 2) + (l.derived ? ' <small class="muted">(from 999)</small>' : '') },
          { label: '+ Import duty', align: 'right', render: (l) => (l.duty == null ? '<small class="muted">included</small>' : l.duty + '%') },
          { label: '+ Premium', align: 'right', render: (l) => l.premium + '%' },
          { label: 'Indian rate \u20B9/g', align: 'right', render: (l) => '<b>' + U.num(l.rate, 2) + '</b>' },
        ],
        rows: r.lines,
      }) : '') +
      (r.alerts && r.alerts.length ? '<div class="banner warn"><b>Check before saving:</b><ul>' + r.alerts.map((a) => '<li>' + esc(a) + '</li>').join('') + '</ul></div>' : '') +
      (r.warnings && r.warnings.length ? '<p class="muted small">Not updated (kept previous rate): ' + esc(r.warnings.join('; ')) + '</p>' : '') +
      (r.basis === 'IBJA'
        ? '<p class="muted small">IBJA benchmark rates include import duty and exclude GST (GST is added on the bill). Purities IBJA does not publish are worked out from the 999 rate by purity. Use the premium in Live rate settings to add your shop\'s margin over IBJA.</p></div>'
        : '<p class="muted small">Indian rate = international price &times; purity &times; (1 + import duty) &times; (1 + premium). GST is added on the bill. Compare with the IBJA rate and adjust the premium in Live rate settings if needed.</p></div>');
  }

  function liveSettings(done) {
    const fields = [
      { name: 'liveProvider', label: 'Rate source', type: 'select', required: true, full: true, options: [
        { value: 'IBJA', label: 'IBJA India benchmark rates (free community feed; falls back to international if unavailable)' },
        { value: 'AUTO', label: 'International spot price converted to Indian rate (free, no key)' },
        { value: 'CUSTOM', label: 'My own feed URL (JSON with G24K, G22K, S999 ...)' }] },
      { name: 'ibjaUrl', label: 'IBJA feed URL', full: true, placeholder: 'https://ibja-api.vercel.app', help: 'Unofficial free service that republishes ibjarates.com. Change only if you host your own copy.' },
      { name: 'rateApiUrl', label: 'Custom feed URL', full: true, placeholder: 'https://example.com/rates.json', help: 'Only for "My own feed". Must allow browser access (CORS).' },
      { name: 'liveDutyGold', label: 'Gold import duty %', type: 'number', min: 0, step: 'any', help: '10% BCD + 5% AIDC = 15% since 13 May 2026' },
      { name: 'liveDutySilver', label: 'Silver import duty %', type: 'number', min: 0, step: 'any' },
      { name: 'liveDutyPlatinum', label: 'Platinum import duty %', type: 'number', min: 0, step: 'any' },
      { name: 'livePremiumPct', label: 'Local premium / discount %', type: 'number', step: 'any', help: 'Use a negative value for a discount to the calculated rate' },
      { name: 'liveAutoMins', label: 'Auto-refresh every (minutes)', type: 'number', min: 0, step: 1, help: '0 = only when you click Refresh. Runs while the app is open at head office.' },
    ];
    UI.modal({
      title: 'Live rate settings', size: 'wide', body: UI.formHtml(fields, DB.settings),
      actions: [{ label: 'Cancel' }, {
        label: 'Save', cls: 'btn primary', onClick: (el) => {
          const d = UI.readForm(el, fields);
          if (!d) return false;
          if (d.liveProvider === 'CUSTOM' && !/^https?:\/\//.test(d.rateApiUrl)) { UI.toast('Enter the feed URL (https://...)', 'error'); return false; }
          if (d.liveAutoMins && d.liveAutoMins < 5) { UI.toast('Auto-refresh must be at least every 5 minutes', 'error'); return false; }
          DB.saveSettings(d);
          LiveRates.startAuto();
          UI.toast('Live rate settings saved');
          if (done) done();
        },
      }],
    });
  }

  Pages.register({
    id: 'rates', title: "Today's Rates", icon: '&#8377;',
    render(el) {
      const canEdit = Auth.can(['Admin', 'Manager']) && Branch.isMaster(); // one rate for all branches, set by head office
      const purities = DB.all('purities').filter((p) => p.metalId !== 'NONE');
      const history = DB.rateHistory();
      const latest = DB.latestRate();
      const cur = pending ? pending.values : latest.values || {};
      let chartKey = 'G22K';

      el.innerHTML =
        '<div class="grid-2">' +
        '<section class="card"><div class="card-head"><h3>' + (canEdit ? 'Update rates' : 'Current rates') + ' <small>₹ per gram</small></h3></div>' +
        '<form class="rate-form" data-nosubmit>' +
        '<div class="rate-inputs">' + purities.map((p) =>
          '<label class="rate-input ' + p.metalId.toLowerCase() + '"><span>' + esc(p.name) + '</span>' +
          '<input type="number" step="any" min="0" name="' + p.id + '" value="' + esc(cur[p.id] || '') + '"' + (canEdit ? '' : ' readonly') + '></label>').join('') + '</div>' +
        (canEdit ? '<div class="live-bar"><button type="button" class="btn live-btn" data-live>&#8635; Refresh live rates</button>' +
          '<span class="muted small">' + esc({ CUSTOM: 'From your feed', IBJA: 'IBJA India benchmark rates from the internet', AUTO: 'International price from the internet, converted to Indian rates' }[LiveRates.settings().provider] || '') +
          (LiveRates.settings().autoMins ? ' &middot; auto every ' + LiveRates.settings().autoMins + ' min' : '') + '</span>' +
          (Auth.can(['Admin']) ? '<button type="button" class="btn sm" data-livesettings>Live rate settings</button>' : '') + '</div>' +
          '<div class="actions-row">' +
          '<button type="button" class="btn" data-derive>Auto-fill from 24K &amp; Fine Silver</button>' +
          '<span class="spacer"></span><button type="button" class="btn primary" data-save>Save rates</button></div>' +
          (pending ? '<div class="banner warn">Live rates from <b>' + esc(pending.source) + '</b> are filled in but <b>not saved yet</b>. Compare them with your market rate, then click <b>Save rates</b>.' +
            (pending.alerts.length ? ' <b>' + pending.alerts.length + ' check(s) need attention</b>, see below.' : '') + '</div>' : '') +
          '<p class="muted small">Saved rates are used immediately on new bills. You can also type rates by hand and Save.</p>' : '') +
        '<p class="muted small">Last updated: ' + (latest.at ? U.fmtDateTime(latest.at) + ' by ' + esc(latest.by || '-') + ' (' + esc(latest.source || '') + ')' : 'never') + '</p>' +
        '</form></section>' +
        '<section class="card"><div class="card-head"><h3>Trend</h3>' +
        '<select class="chart-key">' + purities.map((p) => '<option value="' + p.id + '"' + (p.id === chartKey ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></div>' +
        '<div class="chart-box"></div></section></div>' +
        (canEdit && lastLive ? '<section class="card">' + liveDetail(lastLive) + '</section>' : '') +
        '<section class="card"><div class="card-head"><h3>Rate history</h3></div>' +
        UI.table({
          columns: [{ label: 'Date & time', render: (r) => U.fmtDateTime(r.at) }]
            .concat(purities.map((p) => ({ label: p.name, align: 'right', render: (r) => (r.values[p.id] ? U.num(r.values[p.id], 0) : '-') })))
            .concat([{ label: 'Source', key: 'source' }, { label: 'By', key: 'by' }]),
          rows: history.slice().reverse().slice(0, 60), empty: 'No rates recorded',
        }) + '</section>';

      const drawChart = () => { el.querySelector('.chart-box').innerHTML = lineChart(history, chartKey); };
      drawChart();
      el.querySelector('.chart-key').addEventListener('change', (e) => { chartKey = e.target.value; drawChart(); });

      if (!canEdit) return;
      const form = el.querySelector('.rate-form');
      el.querySelector('[data-derive]').addEventListener('click', () => {
        const g24 = U.n(form.G24K && form.G24K.value);
        const s999 = U.n(form.S999 && form.S999.value);
        purities.forEach((p) => {
          if (p.metalId === 'GOLD' && p.id !== 'G24K' && g24) form[p.id].value = Math.round(g24 * p.fineness / 999);
          if (p.metalId === 'SILVER' && p.id !== 'S999' && s999) form[p.id].value = Math.round(s999 * p.fineness / 999 * 100) / 100;
        });
        UI.toast('Derived from purity (fineness). Adjust to your market rate if needed.');
      });
      const ls = el.querySelector('[data-livesettings]');
      if (ls) ls.addEventListener('click', () => liveSettings(() => App.route()));
      el.querySelector('[data-live]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Checking the internet...';
        try {
          const r = await LiveRates.refresh();
          lastLive = Object.assign(r, { fetchedAt: new Date().toISOString() });
          pending = r;
          UI.toast(r.alerts.length ? 'Live rates loaded with ' + r.alerts.length + ' warning(s). Check them before saving.' : 'Live rates loaded. Check them, then click Save rates.', r.alerts.length ? 'error' : undefined);
          App.route();
        } catch (err) {
          UI.toast('Could not get live rates: ' + err.message + ' You can still enter rates by hand.', 'error');
          btn.disabled = false;
          btn.innerHTML = '&#8635; Refresh live rates';
        }
      });
      el.querySelector('[data-save]').addEventListener('click', async () => {
        const values = {};
        let missing = false;
        purities.forEach((p) => {
          const v = U.n(form[p.id].value);
          if (v > 0) values[p.id] = v; else if (p.showRate) missing = true;
        });
        if (missing) { UI.toast('Please enter all highlighted rates', 'error'); return; }
        // catch typing mistakes and bad feeds: unrealistic rates are refused, big moves need a confirmation
        const chk = LiveRates.check(values);
        if (chk.rejected.length) { UI.toast(chk.warnings.filter((w) => /not a realistic/.test(w)).join('. '), 'error'); return; }
        const fromLive = pending && purities.every((p) => !values[p.id] || values[p.id] === pending.values[p.id]);
        const notes = chk.warnings.concat(fromLive ? pending.alerts.filter((a) => !/changed .*% since/.test(a)) : []);
        if (notes.length && !(await UI.confirm('Please check before saving:\n\n- ' + notes.join('\n- ') + '\n\nSave these rates for all new bills?', 'Yes, rates are correct'))) return;
        try {
          await DB.create('rates', { at: new Date().toISOString(), values, source: fromLive ? 'Live: ' + pending.source + ' (reviewed)' : 'Manual', by: Auth.user.username, confirmedLargeChange: chk.maxPct > 25 });
        } catch (e) { return; }
        pending = null;
        UI.toast('Rates saved and applied to new bills');
        App.route();
      });
    },
  });
})();
