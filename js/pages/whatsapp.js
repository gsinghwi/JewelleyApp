/* WhatsApp: birthday / anniversary wishes, promotional broadcasts to customers & vendors, templates, log */
(function (global) {
  'use strict';
  const esc = U.esc;

  const TABS = [
    { id: 'wishes', label: 'Birthday & anniversary wishes' },
    { id: 'promo', label: 'Promotional broadcast' },
    { id: 'templates', label: 'Message templates' },
    { id: 'log', label: 'Message log' },
    { id: 'setup', label: 'WhatsApp settings' },
  ];

  const modeLabel = () => (WA.mode() === 'API' ? 'Automatic (WhatsApp Business API)' : 'Click-to-chat (opens WhatsApp, you press Send)');

  // Send one message in the current mode. In LINK mode this must run inside a click handler.
  async function sendOne(r) {
    const base = { type: r.type, partyType: r.partyType, partyId: r.party.id, name: r.party.name, phone: r.phone, templateId: r.tpl ? r.tpl.id : '', text: r.text, occasionDate: r.occasionDate || '' };
    if (WA.mode() === 'LINK') {
      window.open(WA.link(r.phone, r.text), '_blank', 'noopener');
      WA.log(Object.assign(base, { mode: 'LINK', status: 'sent' }));
      return { ok: true };
    }
    try {
      const msgId = await WA.sendTemplate(r.phone, r.tpl, r.vars);
      WA.log(Object.assign(base, { mode: 'API', status: 'sent', msgId }));
      return { ok: true };
    } catch (e) {
      WA.log(Object.assign(base, { mode: 'API', status: 'failed', error: e.message }));
      return { ok: false, error: e.message };
    }
  }

  function checkApi(list) {
    if (WA.mode() !== 'API') return null;
    if (!WA.apiReady()) return 'Automatic mode needs the Phone number ID and Access token in WhatsApp settings';
    const noTpl = list.find((r) => !r.tpl || !r.tpl.waTemplateName);
    return noTpl ? 'Automatic mode needs an approved Meta template name on the template used' : null;
  }

  /* Send a list of prepared messages: one-by-one queue (LINK) or automatic with progress (API) */
  function sendBatch(list, title, onDone) {
    const err = checkApi(list);
    if (err) { UI.toast(err, 'error'); return; }
    if (WA.mode() === 'LINK') return linkQueue(list, title, onDone);
    let stop = false;
    const m = UI.modal({
      title, size: 'wide',
      body: '<div class="wa-progress"><div class="bar"><i></i></div><p class="wa-status"></p></div><div class="wa-results"></div>',
      actions: [{ label: 'Stop', cls: 'btn danger', onClick: () => { stop = true; return false; } }, { label: 'Close' }],
    });
    (async () => {
      let ok = 0, failed = 0;
      const lines = [];
      for (let i = 0; i < list.length && !stop; i++) {
        const r = list[i];
        m.el.querySelector('.wa-status').textContent = 'Sending ' + (i + 1) + ' of ' + list.length + ': ' + r.party.name;
        const res = await sendOne(r);
        if (res.ok) ok++; else failed++;
        lines.unshift('<li class="' + (res.ok ? 'ok' : 'err') + '">' + esc(r.party.name) + ' (' + esc(r.phone) + '): ' + (res.ok ? 'sent' : esc(res.error)) + '</li>');
        m.el.querySelector('.bar i').style.width = Math.round(((i + 1) / list.length) * 100) + '%';
        m.el.querySelector('.wa-results').innerHTML = '<ul class="list">' + lines.join('') + '</ul>';
        await new Promise((res2) => setTimeout(res2, 250));
      }
      m.el.querySelector('.wa-status').innerHTML = (stop ? 'Stopped. ' : 'Done. ') + '<b>' + ok + '</b> sent, <b>' + failed + '</b> failed.';
      if (onDone) onDone();
    })();
  }

  function linkQueue(list, title, onDone) {
    let i = 0, sent = 0;
    const m = UI.modal({
      title, size: 'wide',
      body: '<div class="wa-queue"></div>',
      actions: [{ label: 'Close', onClick: () => { if (onDone) onDone(); } }],
    });
    const draw = () => {
      const box = m.el.querySelector('.wa-queue');
      if (i >= list.length) {
        box.innerHTML = '<div class="empty">All done: WhatsApp opened for <b>' + sent + '</b> of ' + list.length + ' contact(s).</div>';
        if (onDone) onDone();
        return;
      }
      const r = list[i];
      box.innerHTML =
        '<div class="wa-progress"><div class="bar"><i style="width:' + Math.round((i / list.length) * 100) + '%"></i></div>' +
        '<p>Contact <b>' + (i + 1) + '</b> of ' + list.length + ': <b>' + esc(r.party.name) + '</b> &middot; +' + esc(r.phone) + '</p></div>' +
        '<div class="wa-bubble">' + esc(r.text).replace(/\n/g, '<br>') + '</div>' +
        '<p class="muted small">WhatsApp opens in a new tab or the desktop app with this message typed in. Press Send there, then come back here for the next contact.</p>' +
        '<div class="actions-row"><button class="btn primary" data-open>Open WhatsApp &amp; mark sent</button><button class="btn" data-skip>Skip</button></div>';
      box.querySelector('[data-open]').addEventListener('click', async () => { await sendOne(r); sent++; i++; draw(); });
      box.querySelector('[data-skip]').addEventListener('click', () => { i++; draw(); });
    };
    draw();
  }

  /* Compose a message to one customer or vendor (used from profiles and the wishes list) */
  function compose(party, partyType, opts) {
    opts = opts || {};
    const phone = WA.normalizePhone(party.phone);
    if (!phone) { UI.toast(party.name + ' has no valid mobile number', 'error'); return; }
    const types = opts.type ? [opts.type] : ['Birthday', 'Anniversary', 'Promotion'];
    const tpls = DB.all('waTemplates').filter((t) => t.active !== false && types.includes(t.type));
    const vars = WA.vars(party, { date: opts.occasionDate ? U.fmtDate(opts.occasionDate) : '' });
    const m = UI.modal({
      title: 'WhatsApp ' + party.name + ' (+' + phone + ')', size: 'wide',
      body: (party.waOptIn ? '' : '<div class="banner warn">This contact has not agreed to receive WhatsApp messages. Send only if they asked you to.</div>') +
        '<div class="field"><label>Template</label><select class="wa-tpl">' + tpls.map((t) => '<option value="' + t.id + '">' + esc(t.type + ': ' + t.name) + '</option>').join('') + '</select></div>' +
        '<div class="field"><label>Message' + (WA.mode() === 'API' ? ' (automatic mode sends the approved template; edits here are not sent)' : '') + '</label><textarea class="wa-text" rows="6"></textarea></div>' +
        '<p class="muted small">Sending mode: ' + esc(modeLabel()) + '</p>',
      actions: [{ label: 'Cancel' }, {
        label: WA.mode() === 'API' ? 'Send now' : 'Open WhatsApp', cls: 'btn primary',
        onClick: (el) => {
          const tpl = DB.get('waTemplates', el.querySelector('.wa-tpl').value);
          const text = el.querySelector('.wa-text').value.trim();
          if (!text) { UI.toast('Message is empty', 'error'); return false; }
          const r = { party, partyType, phone, tpl, vars, text, type: opts.type || (tpl ? tpl.type : 'Direct'), occasionDate: opts.occasionDate };
          const err = checkApi([r]);
          if (err) { UI.toast(err, 'error'); return false; }
          sendOne(r).then((res) => {
            UI.toast(res.ok ? (WA.mode() === 'API' ? 'Message sent to ' + party.name : 'WhatsApp opened for ' + party.name) : 'Failed: ' + res.error, res.ok ? 'ok' : 'error');
            if (opts.onDone) opts.onDone();
          });
        },
      }],
    });
    const sel = m.el.querySelector('.wa-tpl');
    const fill = () => { const t = DB.get('waTemplates', sel.value); m.el.querySelector('.wa-text').value = t ? WA.render(t.body, vars) : ''; };
    if (opts.tplId) sel.value = opts.tplId;
    sel.addEventListener('change', fill);
    fill();
  }

  // ---------------- tabs ----------------

  function wishesTab(box, refresh) {
    const days = U.n(DB.settings.waDaysBefore) || 7;
    const due = WA.dueWishes();
    const upcoming = Biz.upcomingEvents(45).filter((e) => e.inDays > days && (e.type === 'Birthday' || DB.settings.waAnniversary !== false));
    const tplSel = (type) => '<select data-wtpl="' + type + '">' + WA.templatesFor(type).map((t) => '<option value="' + t.id + '">' + esc(t.name) + '</option>').join('') + '</select>';
    const sentLog = DB.all('waLog').filter((l) => l.occasionDate && l.status === 'sent').slice(-10).reverse();

    box.innerHTML =
      '<p class="muted">Greetings go out <b>' + days + ' days before</b> each customer\'s birthday' + (DB.settings.waAnniversary !== false ? ' and anniversary' : '') +
      '. Anyone whose occasion is within that window and has not been wished yet appears here. Open this screen every day (the dashboard also reminds you).</p>' +
      '<div class="toolbar wrap"><label class="inline">Birthday template ' + tplSel('Birthday') + '</label>' +
      (DB.settings.waAnniversary !== false ? '<label class="inline">Anniversary template ' + tplSel('Anniversary') + '</label>' : '') +
      '<span class="spacer"></span>' + (due.length ? '<button class="btn primary" data-sendall>Send all due wishes (' + due.length + ')</button>' : '') + '</div>' +
      '<h4 class="sub">Due to send now</h4>' +
      UI.table({
        columns: [
          { label: 'Customer', render: (e) => '<b>' + esc(e.customer.name) + '</b>' },
          { label: 'Occasion', render: (e) => UI.badge(e.type, e.type === 'Birthday' ? 'gold' : 'ok') },
          { label: 'Date', render: (e) => U.fmtDate(e.date) },
          { label: 'In', render: (e) => (e.inDays === 0 ? 'Today' : e.inDays + ' day' + (e.inDays > 1 ? 's' : '')) + (e.inDays < days ? ' <small class="muted">(late)</small>' : '') },
          { label: 'Mobile', render: (e) => (e.phone ? '+' + esc(e.phone) : UI.badge('No valid mobile', 'err')) },
          { label: 'Consent', render: (e) => (e.customer.waOptIn ? UI.badge('Opted in', 'ok') : UI.badge('Not opted in', 'warn')) },
          { label: '', align: 'right', render: (e) => (e.phone ? '<button class="btn sm primary" data-wish="' + e.customer.id + '|' + e.type + '|' + e.date + '">Send</button>' : '') },
        ],
        rows: due, empty: 'No wishes due right now. Upcoming occasions are listed below.',
      }) +
      '<h4 class="sub">Coming up (next 45 days)</h4>' +
      UI.table({
        columns: [
          { label: 'Customer', render: (e) => esc(e.customer.name) },
          { label: 'Occasion', key: 'type' },
          { label: 'Date', render: (e) => U.fmtDate(e.date) },
          { label: 'Wish goes out', render: (e) => U.fmtDate(U.addDays(e.date, -days)) },
          { label: 'Mobile', render: (e) => esc(e.customer.phone || '-') },
        ],
        rows: upcoming, empty: 'No occasions in the next 45 days',
      }) +
      (sentLog.length ? '<h4 class="sub">Recently wished</h4><ul class="list">' + sentLog.map((l) => '<li>' + esc(l.name) + ' &mdash; ' + esc(l.type) + ' (' + U.fmtDate(l.occasionDate) + '), sent ' + U.fmtDateTime(l.at) + '</li>').join('') + '</ul>' : '');

    const prepared = (e) => {
      const tplId = (box.querySelector('[data-wtpl="' + e.type + '"]') || {}).value;
      const tpl = DB.get('waTemplates', tplId);
      const vars = WA.vars(e.customer, { date: U.fmtDate(e.date) });
      return { party: e.customer, partyType: 'customer', phone: e.phone, tpl, vars, text: tpl ? WA.render(tpl.body, vars) : '', type: e.type, occasionDate: e.date };
    };
    box.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-wish]');
      if (b) {
        const [id, type, date] = b.dataset.wish.split('|');
        const e = due.find((x) => x.customer.id === id && x.type === type && x.date === date);
        const r = prepared(e);
        if (!r.tpl) { UI.toast('Create an active ' + type + ' template first', 'error'); return; }
        compose(e.customer, 'customer', { type, occasionDate: date, tplId: r.tpl.id, onDone: refresh });
      }
      if (ev.target.closest('[data-sendall]')) {
        const list = due.filter((e) => e.phone).map(prepared).filter((r) => r.tpl);
        const skipped = due.length - list.length;
        if (!list.length) { UI.toast('Nothing to send: check mobile numbers and templates', 'error'); return; }
        if (skipped) UI.toast(skipped + ' skipped (no valid mobile or no template)', 'error');
        sendBatch(list, 'Sending ' + list.length + ' wishes', refresh);
      }
    });
  }

  function promoTab(box) {
    const st = { customers: true, vendors: false, group: '', city: '', tplId: (WA.templatesFor('Promotion')[0] || {}).id || '', custom: false, text: '', exclude: {} };
    const groups = DB.all('customerGroups');
    const cities = Array.from(new Set(DB.all('customers').map((c) => c.city).filter(Boolean))).sort();

    function audience() {
      const rows = [];
      if (st.customers) DB.all('customers').filter((c) => (!st.group || c.groupId === st.group) && (!st.city || c.city === st.city)).forEach((c) => rows.push({ party: c, partyType: 'customer' }));
      if (st.vendors) DB.all('vendors').forEach((v) => rows.push({ party: v, partyType: 'vendor' }));
      const seen = {};
      rows.forEach((r) => {
        r.phone = WA.normalizePhone(r.party.phone);
        r.reason = !r.phone ? 'No valid mobile' : !r.party.waOptIn ? 'Not opted in' : seen[r.phone] ? 'Duplicate number' : '';
        if (r.phone && !r.reason) seen[r.phone] = true;
      });
      return rows;
    }

    function messageFor(r) {
      const tpl = DB.get('waTemplates', st.tplId);
      const vars = WA.vars(r.party);
      const body = st.custom ? st.text : tpl ? tpl.body : '';
      return Object.assign(r, { tpl: st.custom ? null : tpl, vars, text: WA.render(body, vars), type: 'Promotion' });
    }

    function draw() {
      const rows = audience();
      const ok = rows.filter((r) => !r.reason);
      const chosen = ok.filter((r) => !st.exclude[r.party.id]);
      const reasons = U.groupBy(rows.filter((r) => r.reason), (r) => r.reason);
      const tpl = DB.get('waTemplates', st.tplId);
      const sample = ok[0] ? messageFor(Object.assign({}, ok[0])).text : (st.custom ? st.text : tpl ? tpl.body : '');
      box.querySelector('.promo-preview').innerHTML = '<div class="wa-bubble">' + esc(sample || 'Choose a template or write a message').replace(/\n/g, '<br>') + '</div>' +
        (ok[0] ? '<p class="muted small">Preview for ' + esc(ok[0].party.name) + '. Each contact gets their own name.</p>' : '');
      box.querySelector('.promo-summary').innerHTML = '<span><b>' + chosen.length + '</b> will receive</span>' +
        Object.entries(reasons).map(([k, v]) => '<span>' + esc(k) + ': <b>' + v.length + '</b></span>').join('') +
        (st.exclude && Object.keys(st.exclude).filter((k) => st.exclude[k]).length ? '<span>Unticked: <b>' + Object.keys(st.exclude).filter((k) => st.exclude[k]).length + '</b></span>' : '');
      box.querySelector('.promo-list').innerHTML = UI.table({
        columns: [
          { label: '', render: (r) => (r.reason ? '' : '<input type="checkbox" data-pick="' + r.party.id + '"' + (st.exclude[r.party.id] ? '' : ' checked') + '>') },
          { label: 'Name', render: (r) => '<b>' + esc(r.party.name) + '</b>' + (r.partyType === 'vendor' && r.party.contactPerson ? '<br><small class="muted">' + esc(r.party.contactPerson) + '</small>' : '') },
          { label: 'Type', render: (r) => UI.badge(r.partyType === 'vendor' ? 'Vendor' : 'Customer', r.partyType === 'vendor' ? '' : 'gold') },
          { label: 'Mobile', render: (r) => esc(r.party.phone || '-') },
          { label: 'Status', render: (r) => (r.reason ? UI.badge(r.reason, 'warn') : UI.badge('Ready', 'ok')) },
        ],
        rows, empty: 'Choose who should receive the message',
      });
      box.querySelector('[data-send]').textContent = 'Send to ' + chosen.length + ' contact' + (chosen.length === 1 ? '' : 's');
      box.querySelector('[data-send]').disabled = !chosen.length;
      box.querySelector('.custom-box').hidden = !st.custom;
      box.querySelector('[data-k=tplId]').disabled = st.custom;
      return chosen;
    }

    box.innerHTML =
      '<div class="grid-2"><div>' +
      '<h4 class="sub">1. Who should receive it?</h4>' +
      '<div class="toolbar wrap"><label class="check"><input type="checkbox" data-k="customers" checked> Customers</label>' +
      '<label class="check"><input type="checkbox" data-k="vendors"> Vendors</label></div>' +
      '<div class="toolbar wrap"><select data-k="group"><option value="">All customer groups</option>' + groups.map((g) => '<option value="' + g.id + '">' + esc(g.name) + '</option>').join('') + '</select>' +
      '<select data-k="city"><option value="">All cities</option>' + cities.map((c) => '<option>' + esc(c) + '</option>').join('') + '</select></div>' +
      '<h4 class="sub">2. Message</h4>' +
      '<div class="toolbar wrap"><select data-k="tplId">' + WA.templatesFor('Promotion').map((t) => '<option value="' + t.id + '">' + esc(t.name) + '</option>').join('') + '</select>' +
      (WA.mode() === 'LINK' ? '<label class="check"><input type="checkbox" data-k="custom"> Write my own message</label>' : '') + '</div>' +
      '<div class="custom-box field" hidden><textarea rows="5" data-k="text" placeholder="Dear {name}, ... You can use {name} {shop} {shopPhone} {address}"></textarea></div>' +
      '</div><div><h4 class="sub">Preview</h4><div class="promo-preview"></div>' +
      '<p class="muted small">Sending mode: ' + esc(modeLabel()) + '. Only contacts who agreed to receive WhatsApp messages are included. Customers can be marked under Customers &rarr; edit.</p></div></div>' +
      '<div class="stock-summary promo-summary"></div>' +
      '<div class="actions-row" style="margin:0 0 12px"><button class="btn sm" data-all>Tick all</button><button class="btn sm" data-none>Untick all</button><span class="spacer"></span><button class="btn primary" data-send>Send</button></div>' +
      '<div class="promo-list"></div>';

    box.addEventListener('input', (e) => {
      const k = e.target.dataset.k;
      if (k) { st[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; draw(); }
      if (e.target.dataset.pick) { st.exclude[e.target.dataset.pick] = !e.target.checked; draw(); }
    });
    box.addEventListener('click', async (e) => {
      if (e.target.closest('[data-all]')) { st.exclude = {}; draw(); }
      if (e.target.closest('[data-none]')) { audience().forEach((r) => { st.exclude[r.party.id] = true; }); draw(); }
      if (e.target.closest('[data-send]')) {
        const chosen = draw().map((r) => messageFor(r));
        if (st.custom && !st.text.trim()) { UI.toast('Write the message first', 'error'); return; }
        if (!st.custom && !DB.get('waTemplates', st.tplId)) { UI.toast('Choose a template', 'error'); return; }
        if (!(await UI.confirm('Send this promotional message to ' + chosen.length + ' contact(s)?', 'Send'))) return;
        sendBatch(chosen, 'Promotional broadcast: ' + chosen.length + ' contact(s)');
      }
    });
    draw();
  }

  function logTab(box) {
    const st = { q: '', type: '' };
    box.innerHTML = '<div class="toolbar wrap"><input type="search" data-q placeholder="Search name or number..."><select data-t><option value="">All types</option><option>Birthday</option><option>Anniversary</option><option>Promotion</option><option>Direct</option></select>' +
      '<span class="spacer"></span><button class="btn" data-csv>Export CSV</button></div><div class="log-body"></div>';
    const cols = [
      { label: 'When', key: 'at', render: (l) => U.fmtDateTime(l.at), csv: (l) => U.fmtDateTime(l.at) },
      { label: 'Type', key: 'type' }, { label: 'To', key: 'name' }, { label: 'Mobile', key: 'phone' },
      { label: 'Mode', key: 'mode', render: (l) => (l.mode === 'API' ? 'Automatic' : 'Click-to-chat') },
      { label: 'Status', key: 'status', render: (l) => (l.status === 'failed' ? UI.badge('Failed', 'err') + '<br><small class="muted">' + esc(l.error) + '</small>' : UI.badge(l.mode === 'API' ? 'Sent' : 'Opened', 'ok')) },
      { label: 'Message', key: 'text', render: (l) => '<small>' + esc(String(l.text || '').slice(0, 80)) + (String(l.text || '').length > 80 ? '...' : '') + '</small>' },
      { label: 'By', key: 'by' },
    ];
    const rows = () => DB.all('waLog').filter((l) => (!st.type || l.type === st.type) && (!st.q || [l.name, l.phone].some((v) => String(v || '').toLowerCase().includes(st.q.toLowerCase())))).slice().reverse();
    const draw = () => { box.querySelector('.log-body').innerHTML = UI.table({ columns: cols, rows: rows().slice(0, 300), empty: 'No messages sent yet' }); };
    box.querySelector('[data-q]').addEventListener('input', U.debounce((e) => { st.q = e.target.value.trim(); draw(); }, 150));
    box.querySelector('[data-t]').addEventListener('change', (e) => { st.type = e.target.value; draw(); });
    box.querySelector('[data-csv]').addEventListener('click', () => U.download('whatsapp-log-' + U.today() + '.csv', U.toCSV(cols, rows()), 'text/csv'));
    draw();
  }

  function setupTab(box) {
    const s = DB.settings;
    const fields = [
      { name: 'waMode', label: 'Sending mode', type: 'select', required: true, full: true, options: [
        { value: 'LINK', label: 'Click-to-chat: free, no setup. Opens WhatsApp with the message typed; you press Send' },
        { value: 'API', label: 'Automatic: WhatsApp Business Cloud API (Meta account and approved templates needed)' }] },
      { name: 'waDaysBefore', label: 'Send wishes how many days before', type: 'number', min: 0, required: true },
      { name: 'waAnniversary', label: 'Also send anniversary wishes', type: 'checkbox' },
      { name: 'waPhoneNumberId', label: 'Phone number ID (Meta)', help: 'WhatsApp Manager > API setup' },
      { name: 'waToken', label: 'Permanent access token (Meta system user)', type: 'password' },
      { name: 'waApiVersion', label: 'Graph API version', placeholder: 'v21.0' },
    ];
    box.innerHTML = '<div class="grid-2"><div>' + UI.formHtml(fields, s) +
      '<div class="actions-row"><button class="btn primary" data-save>Save WhatsApp settings</button><button class="btn" data-test>Send test message</button></div></div>' +
      '<div class="wa-help"><h4 class="sub">Which mode should I use?</h4>' +
      '<p><b>Click-to-chat</b> works straight away with the shop\'s normal WhatsApp or WhatsApp Business app (on this computer, WhatsApp Desktop or web.whatsapp.com must be signed in). Each message opens ready to send; for a broadcast you go through contacts one by one. Best for up to a few dozen messages at a time.</p>' +
      '<p><b>Automatic</b> sends hundreds of messages without clicking, using the official WhatsApp Business Platform:</p>' +
      '<ol class="list"><li>Create a Meta Business account and a WhatsApp Business app at developers.facebook.com.</li>' +
      '<li>Add and verify the shop\'s business phone number. That number can no longer be used in the normal WhatsApp app.</li>' +
      '<li>Create message templates in WhatsApp Manager (the same text as your templates here, with {{1}}, {{2}} ... in place of the placeholders) and wait for approval.</li>' +
      '<li>Create a system user with a permanent token, then paste the Phone number ID and token here, and the approved template names on the Templates tab.</li></ol>' +
      '<p class="muted small">Meta charges per message (marketing messages cost more than greetings or service messages), and only sends to people who agreed to receive them. Keep the opt-in tick on each customer up to date.</p>' +
      '<div class="banner warn">Security: in this prototype the access token is stored in this browser, and only Admins can see this screen. Before going live, move sending to a server so the token never sits on shop computers.</div></div></div>';

    box.querySelector('[data-save]').addEventListener('click', () => {
      const d = UI.readForm(box, fields);
      if (!d) return;
      if (d.waMode === 'API' && (!d.waPhoneNumberId || !d.waToken)) { UI.toast('Automatic mode needs the Phone number ID and access token', 'error'); return; }
      DB.saveSettings(d);
      UI.toast('WhatsApp settings saved');
    });
    box.querySelector('[data-test]').addEventListener('click', () => {
      UI.modal({
        title: 'Send test message',
        body: UI.formHtml([{ name: 'phone', label: 'Mobile number', required: true, placeholder: '98XXXXXXXX' }], {}),
        actions: [{ label: 'Cancel' }, {
          label: 'Continue', cls: 'btn primary', onClick: (el) => {
            const phone = el.querySelector('[name=phone]').value;
            if (!WA.normalizePhone(phone)) { UI.toast('Enter a valid mobile number', 'error'); return false; }
            compose({ id: 'test', name: 'Test contact', phone, waOptIn: true }, 'test', { onDone: () => {} });
          },
        }],
      });
    });
  }

  Pages.register({
    id: 'whatsapp', title: 'WhatsApp', icon: '&#9993;', roles: ['Admin'], masterOnly: true,
    render(el, params) {
      let active = TABS.find((t) => t.id === params.tab) ? params.tab : 'wishes';
      el.innerHTML = '<div class="masters"><nav class="tabs">' + TABS.map((t) => '<button data-tab="' + t.id + '">' + esc(t.label) +
        (t.id === 'wishes' ? ' <small class="wa-due"></small>' : '') + '</button>').join('') +
        '<span class="tab-link muted small">Mode: ' + esc(WA.mode() === 'API' ? 'Automatic' : 'Click-to-chat') + '</span></nav>' +
        '<section class="card wa-body"></section></div>';
      function show(id) {
        active = id;
        el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
        el.querySelector('.wa-due').textContent = WA.dueWishes().length || '';
        // Fresh container per tab so tab listeners never stack
        const old = el.querySelector('.wa-body');
        const box = old.cloneNode(false);
        old.replaceWith(box);
        if (id === 'wishes') wishesTab(box, () => show('wishes'));
        if (id === 'promo') promoTab(box);
        if (id === 'templates') { box.innerHTML = '<div class="crud"></div>'; UI.crud(box.querySelector('.crud'), Schemas.waTemplates); }
        if (id === 'log') logTab(box);
        if (id === 'setup') setupTab(box);
      }
      el.querySelector('.tabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab]');
        if (b) { history.replaceState(null, '', '#/whatsapp?tab=' + b.dataset.tab); show(b.dataset.tab); }
      });
      show(active);
    },
  });

  global.WAUI = { compose };
})(window);
