/* JewelleryApp - app shell, theming and hash router */
(function (global) {
  'use strict';

  const esc = U.esc;
  const root = document.getElementById('app');

  const NAV = [
    { group: 'Overview', ids: ['dashboard', 'rates'] },
    { group: 'Sales', ids: ['pos', 'sales', 'payments', 'customers', 'whatsapp'] },
    { group: 'Pawn Broking', ids: ['pawn'] },
    { group: 'Inventory', ids: ['stock', 'purchases', 'vendors'] },
    { group: 'Admin', ids: ['reports', 'branches', 'masters', 'settings'] },
  ];

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function applyTheme() {
    const s = DB.settings;
    const st = document.documentElement.style;
    st.setProperty('--primary', s.primaryColor || '#7a1f2b');
    st.setProperty('--accent', s.accentColor || '#c9a227');
    const rgb = hexToRgb(s.primaryColor);
    if (rgb) st.setProperty('--primary-rgb', rgb.join(','));
    document.title = (s.shopName || 'JewelleryApp') + ' | JewelleryApp';
  }

  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const params = {};
    (qs || '').split('&').filter(Boolean).forEach((kv) => {
      const [k, v] = kv.split('=');
      params[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return { id: path || 'dashboard', params };
  }

  function rateTicker() {
    const latest = DB.latestRate();
    const v = latest.values || {};
    const show = [['G24K', '24K'], ['G22K', '22K'], ['G18K', '18K'], ['S999', 'Silver']];
    const live = /^Live/.test(latest.source || '');
    return '<a class="ticker" href="#/rates" title="Latest rates per gram' + (live ? ' (live: ' + U.esc(latest.source.replace(/^Live: /, '')) + ')' : '') + '. Click to update.">' +
      (live ? '<i class="live-dot">LIVE</i>' : '') +
      show.map(([k, l]) => '<span><b>' + l + '</b> ' + U.inr(v[k], { whole: true }) + '</span>').join('') +
      '<em>' + (latest.at ? 'as of ' + U.fmtDateTime(latest.at) : 'no rates set') + '</em></a>';
  }

  // Role check plus: master-only pages are hidden from sub-branch users
  const allowed = (p) => p && Auth.can(p.roles) && (!p.masterOnly || Branch.isMaster());

  function branchSwitcher() {
    if (!Branch.isMaster()) {
      return '<span class="branch-pill" title="You can only see this branch">' + esc(Branch.name(Branch.userBranchId())) + '</span>';
    }
    const v = Branch.viewId();
    return '<select class="branch-select" title="Branch shown">' +
      '<option value="ALL"' + (v === 'ALL' ? ' selected' : '') + '>All branches (consolidated)</option>' +
      Branch.all().filter((b) => b.active !== false).map((b) => '<option value="' + b.id + '"' + (v === b.id ? ' selected' : '') + '>' + esc(b.name) + (b.type === 'MASTER' ? ' (master)' : '') + '</option>').join('') +
      '</select>';
  }

  function renderShell() {
    const s = DB.settings;
    const u = Auth.user;
    const nav = NAV.map((g) => {
      const links = g.ids.map((id) => Pages.get(id)).filter(allowed);
      if (!links.length) return '';
      return '<div class="nav-group"><div class="nav-title">' + g.group + '</div>' +
        links.map((p) => '<a href="#/' + p.id + '" data-nav="' + p.id + '"><span class="ico">' + p.icon + '</span>' + esc(p.title) + '</a>').join('') + '</div>';
    }).join('');

    root.innerHTML =
      '<div class="shell">' +
      '<aside class="sidebar">' +
      '<div class="brand">' + (s.logo ? '<img src="' + esc(s.logo) + '" alt="">' : '<div class="mono">' + esc((s.shopName || 'J').charAt(0)) + '</div>') +
      '<div><div class="brand-name">' + esc(s.shopName) + '</div><div class="brand-sub">JewelleryApp</div></div></div>' +
      '<nav>' + nav + '</nav>' +
      '</aside>' +
      '<div class="scrim"></div>' +
      '<main class="main">' +
      '<header class="topbar">' +
      '<button class="icon-btn menu-btn" aria-label="Menu">&#9776;</button>' +
      '<h2 class="page-title"></h2>' +
      '<div class="ticker-slot">' + rateTicker() + '</div>' +
      '<div class="branch-slot">' + branchSwitcher() + '</div>' +
      '<span class="sync-status" title="Changes are saved to the JewelleryApp database">Saved</span>' +
      '<div class="user-menu"><button class="user-btn">' + esc(u.name) + ' <small>' + esc(u.role) + '</small> &#9662;</button>' +
      '<div class="user-drop" hidden><button data-act="password">Change password</button><button data-act="logout">Sign out</button></div></div>' +
      '</header>' +
      (!DB.latestRate().at ? '<div class="banner warn">No gold / silver rates are saved yet. Bills need today\'s rates: open <a href="#/rates">Today\'s Rates</a> and refresh or enter them.</div>' : '') +
      '<div id="view" class="view"></div>' +
      '</main></div>';

  }

  root.addEventListener('change', (e) => {
    if (!e.target.classList.contains('branch-select')) return;
    Branch.setView(e.target.value);
    UI.toast('Showing ' + Branch.viewLabel());
    App.refreshShell();
  });

  // Shell interactions are delegated once on the root, so re-rendering the shell never stacks listeners
  root.addEventListener('click', (e) => {
    const shell = root.querySelector('.shell');
    if (!shell) return;
    const drop = root.querySelector('.user-drop');
    if (e.target.closest('.user-btn')) { drop.hidden = !drop.hidden; return; }
    if (drop) drop.hidden = true;
    if (e.target.closest('.menu-btn')) { shell.classList.toggle('nav-open'); return; }
    if (e.target.closest('.scrim') || e.target.closest('.sidebar a')) shell.classList.remove('nav-open');
    const act = e.target.closest('[data-act]');
    if (!act) return;
    e.preventDefault();
    if (act.dataset.act === 'logout') {
      LiveRates.stopAuto();
      DB.flush().finally(() => { Auth.logout(); DB.clear(); Branch.clearView(); history.replaceState(null, '', location.pathname); start(); });
    }
    if (act.dataset.act === 'password') changePassword();
  });

  function changePassword() {
    const fields = [
      { name: 'current', label: 'Current password', type: 'password', required: true },
      { name: 'next', label: 'New password', type: 'password', required: true, help: 'At least 8 characters' },
      { name: 'confirm', label: 'Confirm new password', type: 'password', required: true },
    ];
    UI.modal({
      title: 'Change password',
      body: UI.formHtml(fields, {}),
      actions: [{ label: 'Cancel' }, {
        label: 'Update', cls: 'btn primary', onClick: (el) => {
          const d = UI.readForm(el, fields);
          if (!d) return false;
          if (d.next.length < 8) { UI.toast('New password must be at least 8 characters', 'error'); return false; }
          if (d.next !== d.confirm) { UI.toast('Passwords do not match', 'error'); return false; }
          Auth.changePassword(d.current, d.next).then(() => {
            UI.toast('Password updated');
          }).catch((ex) => UI.toast('Password not changed: ' + DB.errorText(ex).replace(/oldPassword/i, 'current password'), 'error'));
        },
      }],
    });
  }

  function route() {
    if (!Auth.user) return;
    const { id, params } = parseHash();
    let page = Pages.get(id);
    if (!allowed(page)) page = Pages.get('dashboard');
    root.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === page.id));
    root.querySelector('.page-title').textContent = page.title;
    root.querySelector('.ticker-slot').innerHTML = rateTicker();
    // Pop-ups belong to the screen that opened them
    document.querySelectorAll('.modal-wrap').forEach((m) => (m.closeModal ? m.closeModal() : m.remove()));
    // Fresh element per page so listeners a page attaches to its view never outlive it
    const old = root.querySelector('#view');
    const view = old.cloneNode(false);
    old.replaceWith(view);
    window.scrollTo(0, 0);
    page.render(view, params);
  }

  function loading(text) {
    root.innerHTML = '<div class="boot"><div class="boot-box"><div class="spinner"></div><p>' + esc(text) + '</p></div></div>';
  }

  // After sign in: first-login password change, then load the data and open the app
  async function enter() {
    if (Auth.mustChangePassword()) {
      Auth.renderChangePassword(root, enter);
      return;
    }
    loading('Loading your data...');
    await DB.loadAll();
    await PG.loadConfig();
    applyTheme();
    renderShell();
    route();
    LiveRates.startAuto();
  }

  async function start() {
    loading('Connecting to the JewelleryApp database...');
    try {
      await DB.loadPublicSettings();
      await DB.api('health');
    } catch (e) {
      root.innerHTML = '<div class="boot"><div class="boot-box"><h2>Cannot reach the database</h2><p class="muted">The server laptop may be switched off or asleep, the JewelleryApp Database service may be stopped, or this device is not on the shop Wi-Fi.</p>' +
        '<p class="muted small">On the server laptop: open Services and start "JewelleryApp Database", or restart the laptop. On another device: check it is on the same Wi-Fi as the server laptop.</p><button class="btn primary" onclick="location.reload()">Try again</button></div></div>';
      return;
    }
    applyTheme();
    if (!(await Auth.restore())) {
      Auth.renderLogin(root, enter);
      return;
    }
    await enter();
  }

  // Another computer changed data: refresh the screen unless the user is in the middle of something
  let refreshTimer = null;
  function softRefresh(themeToo) {
    if (!Auth.user || !root.querySelector('.shell')) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      const a = document.activeElement;
      const busy = document.querySelector('.modal-wrap') || (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName) && root.contains(a));
      if (busy) { refreshTimer = setTimeout(() => softRefresh(themeToo), 3000); return; }
      if (themeToo) { applyTheme(); renderShell(); }
      const y = window.scrollY;
      route();
      window.scrollTo(0, y);
    }, 400);
  }

  global.App = {
    start, route, applyTheme,
    refreshShell() { applyTheme(); renderShell(); route(); },
    softRefresh,
    updateTicker() { const t = root.querySelector('.ticker-slot'); if (t) t.innerHTML = rateTicker(); },
    go(hash) { if (location.hash === hash) route(); else location.hash = hash; },
  };

  window.addEventListener('hashchange', route);
  document.addEventListener('DOMContentLoaded', start);
})(window);
