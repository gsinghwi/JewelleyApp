/* Settings: shop branding (login page + invoices), billing preferences, payment gateway keys,
 * users, daily backup and the MySQL export */
(function () {
  'use strict';
  const esc = U.esc;

  const brandFields = [
    { name: 'shopName', label: 'Shop name', required: true },
    { name: 'tagline', label: 'Tagline' },
    { name: 'loginWelcome', label: 'Login page message', full: true },
    { name: 'logo', label: 'Logo (PNG/JPG/SVG, under 600 KB)', type: 'image' },
    { name: 'loginBg', label: 'Login background image (optional)', type: 'image' },
    { name: 'primaryColor', label: 'Primary colour', type: 'color' },
    { name: 'accentColor', label: 'Accent colour', type: 'color' },
  ];
  const shopFields = [
    { name: 'address', label: 'Shop address', full: true },
    { name: 'phone', label: 'Phone' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'gstin', label: 'GSTIN', maxlength: 15 },
    { name: 'pan', label: 'PAN', maxlength: 10 },
    { name: 'bisLicence', label: 'BIS hallmark licence no.' },
    { name: 'state', label: 'State', type: 'select', options: Schemas.STATES },
    { name: 'stateCode', label: 'GST state code', maxlength: 2 },
  ];
  const billingFields = [
    { name: 'invoicePrefix', label: 'Invoice prefix', required: true },
    { name: 'purchasePrefix', label: 'Purchase prefix', required: true },
    { name: 'tagPrefix', label: 'Stock tag prefix', required: true },
    { name: 'hallmarkCharge', label: 'Default hallmark charge per piece (₹)', type: 'number', min: 0 },
    { name: 'terms', label: 'Invoice terms & conditions', type: 'textarea', rows: 5, full: true },
  ];

  const paymentFields = [
    { name: 'pgMode', label: 'Online payments', type: 'select', required: true, full: true, options: [
      { value: 'SIMULATED', label: 'Test gateway (simulated): try the full flow, no real money' },
      { value: 'RAZORPAY', label: 'Razorpay: test or live, using the keys below' },
      { value: 'OFF', label: 'Off: hide "Collect online"' }] },
  ];

  const backupFields = [
    { name: 'backupDir', label: 'Backup folder (on the server laptop)', full: true, required: true,
      help: 'For example D:\\JewelleryBackups or a USB / OneDrive / Google Drive folder. The folder is created if it does not exist.' },
    { name: 'backupTime', label: 'Daily backup time (24 h)', type: 'time', required: true },
    { name: 'backupKeep', label: 'Keep last N backups', type: 'number', min: 1, max: 365 },
  ];

  const PRESETS = [
    ['Royal Maroon', '#7a1f2b', '#c9a227'], ['Emerald', '#0f5c4a', '#d4af37'], ['Midnight', '#1d2a4d', '#c9a227'],
    ['Rose Gold', '#8c4a52', '#e0a98f'], ['Classic Black', '#1f1f1f', '#d4af37'], ['Peacock', '#0b4f6c', '#e3b23c'],
  ];

  function preview(s) {
    return '<div class="brand-preview" style="--p:' + esc(s.primaryColor) + ';--a:' + esc(s.accentColor) + '">' +
      '<div class="bp-left" style="' + (s.loginBg ? 'background-image:linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.55)),url(' + esc(s.loginBg) + ')' : '') + '">' +
      (s.logo ? '<img src="' + esc(s.logo) + '" alt="">' : '<div class="login-mono">' + esc((s.shopName || 'J').charAt(0)) + '</div>') +
      '<b>' + esc(s.shopName) + '</b><small>' + esc(s.tagline) + '</small></div>' +
      '<div class="bp-right"><b>Sign in</b><span></span><span></span><i></i></div></div>';
  }

  Pages.register({
    id: 'settings', title: 'Settings & Branding', icon: '&#9881;', roles: ['Admin'], masterOnly: true,
    render(el) {
      const s = DB.settings;
      el.innerHTML =
        '<div class="grid-2 settings">' +
        '<section class="card"><div class="card-head"><h3>Branding (login page, sidebar &amp; invoices)</h3></div>' +
        '<div class="brand-form">' + UI.formHtml(brandFields, s) + '</div>' +
        '<div class="presets"><span class="muted small">Colour themes:</span>' + PRESETS.map(([n, p, a]) => '<button class="preset" data-preset="' + p + ',' + a + '" title="' + n + '" style="background:linear-gradient(135deg,' + p + ' 60%,' + a + ' 60%)"></button>').join('') + '</div>' +
        '<h4 class="sub">Login page preview</h4><div class="preview-box">' + preview(s) + '</div></section>' +
        '<section class="card"><div class="card-head"><h3>Shop details</h3></div><div class="shop-form">' + UI.formHtml(shopFields, s) + '</div>' +
        '<div class="card-head"><h3>Billing &amp; rates</h3></div><div class="billing-form">' + UI.formHtml(billingFields, s) + '</div>' +
        '<div class="card-head"><h3>Payment gateway</h3><a href="#/payments">View payments &rarr;</a></div><div class="pg-form">' + UI.formHtml(paymentFields, s) + '</div></section>' +
        '</div>' +
        '<div class="sticky-save"><button class="btn primary" data-save>Save settings</button></div>' +
        '<section class="card"><div class="card-head"><h3>Users &amp; roles</h3><small class="muted">Admin: everything &middot; Manager: all except settings &amp; users &middot; Sales: billing, customers, stock view</small></div><div class="users-crud"></div></section>' +
        '<section class="card"><div class="card-head"><h3>Open on other laptops / tablets</h3></div><div class="net-box"><p class="muted">Loading...</p></div></section>' +
        '<section class="card"><div class="card-head"><h3>Razorpay keys</h3><small class="muted">Kept on the server only; the secret is never shown again</small></div><div class="rzp-keys"><p class="muted">Loading...</p></div></section>' +
        '<section class="card"><div class="card-head"><h3>Daily backup</h3></div>' +
        '<p class="muted">The database is backed up automatically every day at the time below (and on the next start if the laptop was off). Save settings after changing the folder or time.</p>' +
        '<div class="backup-form">' + UI.formHtml(backupFields, s) + '</div>' +
        '<div class="backup-status"><p class="muted">Loading backup status...</p></div>' +
        '<div class="actions-row"><button class="btn" data-backup-now>Back up now</button><span class="spacer"></span>' +
        '<button class="btn" data-export-mysql title="Download all data as a MySQL 8 script (see docs/MIGRATE-TO-MYSQL)">Export for MySQL</button></div>' +
        '<h4 class="sub">Recent activity</h4><div class="audit"></div></section>';

      UI.bindImageInputs(el);
      UI.crud(el.querySelector('.users-crud'), Schemas.users);

      const current = () => {
        const d = {};
        [['.brand-form', brandFields], ['.shop-form', shopFields], ['.billing-form', billingFields], ['.pg-form', paymentFields], ['.backup-form', backupFields]].forEach(([sel, f]) => {
          f.forEach((field) => {
            const inp = el.querySelector(sel + ' [name="' + field.name + '"]');
            if (!inp) return;
            d[field.name] = field.type === 'checkbox' ? inp.checked : field.type === 'number' ? U.n(inp.value) : inp.value.trim();
          });
        });
        return d;
      };
      const refreshPreview = () => { el.querySelector('.preview-box').innerHTML = preview(Object.assign({}, s, current())); };
      el.querySelector('.brand-form').addEventListener('input', refreshPreview);
      el.querySelector('.brand-form').addEventListener('imagechange', refreshPreview);

      el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
        const [p, a] = b.dataset.preset.split(',');
        el.querySelector('[name=primaryColor]').value = p;
        el.querySelector('[name=accentColor]').value = a;
        refreshPreview();
      }));

      el.querySelector('[data-save]').addEventListener('click', () => {
        const d = current();
        if (!d.shopName) { UI.toast('Shop name is required', 'error'); return; }
        if (!d.invoicePrefix || !d.tagPrefix || !d.purchasePrefix) { UI.toast('Prefixes cannot be empty', 'error'); return; }
        if (d.gstin && !/^[0-9]{2}[A-Z0-9]{13}$/i.test(d.gstin)) { UI.toast('GSTIN should be 15 characters', 'error'); return; }
        d.gstin = (d.gstin || '').toUpperCase();
        if (d.pgMode === 'RAZORPAY' && !PG.serverConfig.enabled) UI.toast('Razorpay is selected but its keys are not saved yet: add them under Razorpay keys', 'error');
        if (!d.backupDir) { UI.toast('Enter a backup folder', 'error'); return; }
        if (!/^\d{2}:\d{2}$/.test(d.backupTime)) { UI.toast('Enter the backup time as HH:MM', 'error'); return; }
        d.backupKeep = Math.min(365, Math.max(1, Math.round(d.backupKeep) || 30));
        if (d.gstin && !d.stateCode) d.stateCode = d.gstin.slice(0, 2);
        DB.saveSettings(d);
        DB.flush().then(() => { UI.toast('Settings saved'); loadBackup(); });
        App.refreshShell();
      });

      // ---- Razorpay keys (stored in the server's secrets, never in the settings) ----
      const keysBox = el.querySelector('.rzp-keys');
      const renderKeys = (rp) => {
        keysBox.innerHTML =
          '<div class="form-grid">' +
          '<div class="field full"><label>Key ID</label><input name="rzpKeyId" value="' + esc(rp.keyId || '') + '" placeholder="rzp_test_xxxxxxxxxxxxxx" autocomplete="off"></div>' +
          '<div class="field full"><label>Key Secret</label><input name="rzpSecret" type="password" autocomplete="new-password" placeholder="' +
          (rp.secretSet ? 'Saved (' + esc(rp.secretHint) + '). Leave blank to keep it' : 'Paste the Key Secret') + '"></div></div>' +
          '<p class="muted small">Razorpay Dashboard &gt; Account &amp; Settings &gt; API Keys. Use rzp_test_ keys to try it without real money. ' +
          (rp.keyId ? 'Current mode: <b>' + (rp.mode === 'live' ? 'LIVE' : 'TEST') + '</b>.' : '') + '</p>' +
          '<div class="actions-row"><button class="btn primary" data-save-keys>Save keys</button>' +
          (rp.secretSet ? '<button class="btn danger" data-clear-keys>Remove secret</button>' : '') + '</div>';
      };
      const saveKeys = (body, msg) => DB.api('integrations', { method: 'POST', body: { razorpay: body } })
        .then((r) => { UI.toast(msg); renderKeys(r.razorpay || {}); return PG.loadConfig(); })
        .catch((ex) => UI.toast('Keys not saved: ' + DB.errorText(ex), 'error'));
      keysBox.addEventListener('click', (e) => {
        if (e.target.closest('[data-save-keys]')) {
          const keyId = keysBox.querySelector('[name=rzpKeyId]').value.trim();
          const keySecret = keysBox.querySelector('[name=rzpSecret]').value.trim();
          if (keyId && !/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId)) { UI.toast('The Key ID starts with rzp_test_ or rzp_live_', 'error'); return; }
          saveKeys({ keyId, keySecret }, 'Razorpay keys saved');
        }
        if (e.target.closest('[data-clear-keys]')) {
          UI.confirm('Remove the saved Razorpay Key Secret? Online payments will stop until a new one is saved.', 'Remove')
            .then((ok) => { if (ok) saveKeys({ keyId: keysBox.querySelector('[name=rzpKeyId]').value.trim(), clearSecret: true }, 'Secret removed'); });
        }
      });
      DB.api('integrations').then((r) => renderKeys(r.razorpay || {}))
        .catch((ex) => { keysBox.innerHTML = '<p class="muted">Could not load: ' + esc(DB.errorText(ex)) + '</p>'; });

      // ---- Network address for other devices ----
      DB.api('network').then((n) => {
        const urls = n.urls || [];
        el.querySelector('.net-box').innerHTML = !n.lanEnabled
          ? '<p>Only this laptop can open JewelleryApp (address <code>' + esc(n.listen) + '</code>). To allow other devices on the shop Wi-Fi, see the Installation guide.</p>'
          : '<p>Any laptop, tablet or phone on the <b>same Wi-Fi</b> can open JewelleryApp in Chrome or Edge at:</p>' +
            (urls.length ? '<ul class="net-urls">' + urls.map((u) => '<li><a href="' + esc(u) + '" target="_blank"><b>' + esc(u) + '</b></a></li>').join('') + '</ul>'
              : '<p class="muted">This laptop is not connected to a network right now.</p>') +
            (n.byName ? '<p class="muted small">Also usually works: <code>' + esc(n.byName) + '</code> &middot; on this laptop: <code>' + esc(n.local) + '</code></p>' : '') +
            '<p class="muted small">Each person signs in with their own username. Ask your router admin to give this laptop a fixed (reserved) IP so the address does not change, and set the Wi-Fi to <b>Private</b> in Windows network settings.</p>';
      }).catch((ex) => { el.querySelector('.net-box').innerHTML = '<p class="muted">' + esc(DB.errorText(ex)) + '</p>'; });

      // ---- Backups ----
      const statusBox = el.querySelector('.backup-status');
      function loadBackup() {
        DB.api('backup').then((b) => {
          const last = b.last || {};
          const files = (b.files || []).sort((x, y) => (x.name < y.name ? 1 : -1));
          statusBox.innerHTML =
            '<p>Last backup: ' + (last.at ? U.fmtDateTime(last.at) + ' ' + (last.ok ? UI.badge('OK', 'ok') : UI.badge('FAILED', 'err')) +
              (last.error ? ' <span class="muted">' + esc(last.error) + '</span>' : '') : '<span class="muted">none yet</span>') + '</p>' +
            '<p class="muted small">Folder: <code>' + esc(b.dir) + '</code> &middot; every day at ' + esc(b.time) + ' &middot; keeps ' + esc(b.keep) + '</p>' +
            UI.table({
              columns: [{ label: 'Backup file', key: 'name' }, { label: 'Size', render: (f) => (f.size / 1048576).toFixed(1) + ' MB' },
                { label: 'Made', render: (f) => U.fmtDateTime(f.modified) }],
              rows: files.slice(0, 10), empty: 'No backups in the folder yet',
            });
        }).catch((ex) => { statusBox.innerHTML = '<p class="muted">Could not read backup status: ' + esc(DB.errorText(ex)) + '</p>'; });
      }
      loadBackup();
      el.querySelector('[data-backup-now]').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = 'Backing up...';
        DB.api('backup', { method: 'POST' }).then((st) => UI.toast('Backup saved: ' + (st.copy || st.file)))
          .catch((ex) => UI.toast(DB.errorText(ex), 'error'))
          .finally(() => { btn.disabled = false; btn.textContent = 'Back up now'; loadBackup(); });
      });
      el.querySelector('[data-export-mysql]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const res = await fetch('/api/jw/export/mysql', { headers: { Authorization: DB.pb.authStore.token } });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'HTTP ' + res.status);
          const name = (/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || 'jewelleryapp-mysql.sql';
          const url = URL.createObjectURL(await res.blob());
          const a = document.createElement('a');
          a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          UI.toast('MySQL export downloaded: ' + name);
        } catch (ex) {
          UI.toast('Export failed: ' + ex.message, 'error');
        } finally {
          btn.disabled = false;
        }
      });

      el.querySelector('.audit').innerHTML = UI.table({
        columns: [
          { label: 'When', render: (a) => U.fmtDateTime(a.at) }, { label: 'User', key: 'user' },
          { label: 'Action', key: 'action' }, { label: 'Record', render: (a) => esc(a.col + ' ' + (a.id || '')) },
        ],
        rows: DB.all('audit').slice(-25).reverse(), empty: 'No activity yet',
      });
    },
  });
})();
