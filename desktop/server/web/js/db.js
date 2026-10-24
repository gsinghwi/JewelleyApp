/* JewelleryApp - data layer for the PocketBase server.
 *
 * The screens work on an in-memory copy of the data (fast and simple), loaded from the server
 * after login. Every change is sent to the server:
 *   - DB.insert / update / remove queue the change and save it in the background
 *   - DB.create(...) waits for the server (used where the server assigns a number, e.g. invoices)
 *   - DB.persist() finds records changed in place (e.g. a stock piece marked sold) and saves them
 * Changes made on other computers arrive through PocketBase realtime and refresh the screen.
 *
 * Access control is enforced by the server (branch rules, roles); the branch filter here only
 * mirrors it for the head office "view one branch" switch.
 */
(function (global) {
  'use strict';

  const pb = new PocketBase(location.origin);
  pb.autoCancellation(false);

  const COLLECTIONS = ['branches', 'currencies', 'categories', 'metals', 'purities', 'hsn', 'stoneTypes', 'paymentModes', 'customerGroups',
    'items', 'rates', 'waTemplates', 'waLog', 'vendors', 'purchases', 'vendorPayments', 'customers', 'stock', 'invoices', 'receipts',
    'pawns', 'gatewayPayments', 'transfers'];
  const OWNED = ['purchases', 'vendorPayments', 'customers', 'stock', 'invoices', 'receipts', 'pawns', 'gatewayPayments'];
  const NUMBERED = { invoices: 'invoiceNo', receipts: 'receiptNo', pawns: 'pawnNo', purchases: 'purchaseNo', transfers: 'transferNo', stock: 'tagNo', customers: 'code' };
  const FULL_CHECK_LIMIT = 3000; // larger collections only sync records marked as changed
  const STAFF_FIELDS = ['username', 'name', 'role', 'branchId', 'active', 'isMaster', 'mustChangePassword'];

  function errorText(e) {
    const d = e && e.response && e.response.data;
    if (d && typeof d === 'object') {
      const k = Object.keys(d)[0];
      if (k && d[k] && d[k].message) return (k === 'password' || k === 'passwordConfirm' ? 'Password: ' : '') + d[k].message;
    }
    return (e && e.response && e.response.message) || (e && e.message) || 'Request failed';
  }

  // ---- mapping between app objects and PocketBase records ----
  // Safe defaults so one damaged or incomplete record cannot break a screen
  const SHAPES = {
    invoices: { arr: ['lines', 'payments', 'settlements', 'oldGold'], str: ['date', 'status', 'customerId'], num: ['grandTotal', 'paid', 'balance', 'taxable', 'cgst', 'sgst', 'igst'] },
    receipts: { str: ['date', 'customerId', 'mode'], num: ['amount'] },
    pawns: { arr: ['items', 'payments', 'extensions'], str: ['date', 'dueDate', 'status', 'customerId'], num: ['principal', 'interestPct', 'netWt', 'grossWt', 'value'] },
    stock: { str: ['status', 'itemId', 'purityId', 'tagNo'], num: ['netWt', 'grossWt', 'stoneWt', 'costPrice'] },
    purchases: { arr: ['lines'], str: ['billDate', 'vendorId'], num: ['total', 'paid'] },
    vendorPayments: { str: ['date', 'vendorId'], num: ['amount'] },
    transfers: { arr: ['pieces'], str: ['date'] },
    customers: { str: ['name', 'phone'] },
    vendors: { str: ['name', 'phone'] },
    items: { str: ['name', 'categoryId', 'purityId'] },
    rates: { str: ['at', 'source'] },
    gatewayPayments: { str: ['status', 'createdAt'], num: ['amount'] },
  };
  function normalize(col, o) {
    const sh = SHAPES[col];
    if (!sh) return o;
    (sh.arr || []).forEach((k) => { if (!Array.isArray(o[k])) o[k] = []; });
    (sh.str || []).forEach((k) => { if (typeof o[k] !== 'string') o[k] = o[k] == null ? '' : String(o[k]); });
    (sh.num || []).forEach((k) => { if (typeof o[k] !== 'number' || !isFinite(o[k])) o[k] = Number(o[k]) || 0; });
    if (col === 'rates' && (typeof o.values !== 'object' || !o.values)) o.values = {};
    return o;
  }

  function toApp(col, r) {
    if (col === 'users') {
      const u = { id: r.id };
      STAFF_FIELDS.forEach((f) => { u[f] = r[f]; });
      return u;
    }
    const o = Object.assign({}, r.data || {});
    o.id = r.id;
    if (OWNED.indexOf(col) >= 0) o.branchId = r.branchId || '';
    if (col === 'transfers') { o.fromBranchId = r.fromBranchId || o.fromBranchId; o.toBranchId = r.toBranchId || o.toBranchId; }
    if (NUMBERED[col] && r.docNo) o[NUMBERED[col]] = r.docNo;
    if (col === 'customers' && r.branchId === '' && o.branchId === '') delete o.branchId; // shared (walk-in)
    return normalize(col, o);
  }

  function toPB(col, o) {
    if (col === 'users') {
      const u = {};
      STAFF_FIELDS.forEach((f) => { if (o[f] !== undefined && f !== 'isMaster') u[f] = o[f]; });
      return u;
    }
    const data = {};
    Object.keys(o).forEach((k) => { if (k !== 'id' && o[k] !== undefined) data[k] = o[k]; });
    const rec = { data };
    if (OWNED.indexOf(col) >= 0) rec.branchId = o.branchId || '';
    if (col === 'transfers') { rec.fromBranchId = o.fromBranchId || ''; rec.toBranchId = o.toBranchId || ''; }
    return rec;
  }

  const sig = (col, o) => JSON.stringify(toPB(col, o));

  const DB = {
    pb,
    data: { settings: {} },
    snap: {},       // col -> id -> last synced signature
    dirty: {},      // col -> Set(id) changed in place, for large collections
    queue: Promise.resolve(),
    pending: 0,
    loaded: false,

    // Branding for the login page (readable without signing in)
    async loadPublicSettings() {
      try {
        const r = await pb.collection('appSettings').getOne('main');
        this.data.settings = Object.assign({}, r.data || {});
      } catch (e) {
        this.data.settings = this.data.settings || {};
      }
      this.snap.settings = JSON.stringify(this.data.settings);
      return this.data.settings;
    },

    async loadAll(onProgress) {
      await this.loadPublicSettings();
      const lists = await Promise.all(COLLECTIONS.map(async (col) => {
        try {
          return [col, await pb.collection(col).getFullList({ batch: 1000, sort: 'created' })];
        } catch (e) {
          return [col, []]; // not allowed for this user
        }
      }));
      lists.forEach(([col, recs]) => this.setCollection(col, recs));
      try {
        this.setCollection('users', await pb.collection('staff').getFullList({ batch: 200, sort: 'username' }));
      } catch (e) { this.setCollection('users', []); }
      this.loaded = true;
      if (onProgress) onProgress();
      this.subscribe();
    },

    setCollection(col, recs) {
      this.changed();
      this.data[col] = recs.map((r) => toApp(col, r));
      this.snap[col] = {};
      this.data[col].forEach((o) => { this.snap[col][o.id] = sig(col, o); });
      this.dirty[col] = new Set();
    },

    clear() {
      this.changed();
      try { pb.realtime.unsubscribe(); } catch (e) { /* ignore */ }
      this.data = { settings: this.data.settings || {} };
      this.snap = {};
      this.dirty = {};
      this.loaded = false;
    },

    get settings() { return this.data.settings; },

    // Cached lookups (filtered lists, id index, per-customer totals) are rebuilt only after a change
    ver: 0,
    cache: {},
    changed() { this.ver++; },
    memo(key, fn) {
      const c = this.cache[key];
      if (c && c.v === this.ver) return c.val;
      const val = fn();
      this.cache[key] = { v: this.ver, val };
      return val;
    },

    saveSettings(patch) {
      Object.assign(this.data.settings, patch || {});
      this.syncSettings();
    },

    syncSettings() {
      const now = JSON.stringify(this.data.settings);
      if (now === this.snap.settings) return Promise.resolve();
      this.snap.settings = now;
      const data = JSON.parse(now);
      return this.enqueue(() => pb.collection('appSettings').update('main', { data }), 'settings');
    },

    // ---- reads ----
    raw(col) {
      return this.data[col] || (this.data[col] = []);
    },

    all(col) {
      const arr = this.raw(col);
      if (!(global.Branch && Branch.OWNED.indexOf(col) >= 0 && global.Auth && Auth.user)) return arr;
      const v = Branch.viewId();
      if (v === 'ALL') return arr;
      return this.memo('all:' + col + ':' + v + ':' + arr.length, () => arr.filter((r) => Branch.visibleIn(col, r, v)));
    },

    get(col, id) {
      const arr = this.raw(col);
      const idx = this.memo('idx:' + col + ':' + arr.length, () => new Map(arr.map((r) => [r.id, r])));
      const r = idx.get(id);
      return r && (!global.Branch || Branch.visible(col, r)) ? r : null;
    },

    find(col, pred) {
      return this.all(col).find(pred) || null;
    },

    // ---- writes ----
    enqueue(fn, what) {
      this.pending++;
      this.updateStatus();
      const p = this.queue.then(fn).catch((e) => {
        UI.toast('Could not save ' + (what || 'change') + ': ' + errorText(e), 'error');
        throw e;
      }).finally(() => { this.pending--; this.updateStatus(); });
      this.queue = p.catch(() => {});
      return p;
    },

    updateStatus() {
      const el = document.querySelector('.sync-status');
      if (el) {
        el.textContent = this.pending ? 'Saving...' : 'Saved';
        el.classList.toggle('busy', !!this.pending);
      }
    },

    markDirty(col, rec) {
      (this.dirty[col] = this.dirty[col] || new Set()).add(rec.id);
      this.persist();
    },

    // Waits for the server; returns the saved record with server-assigned numbers
    async create(col, obj) {
      const rec = Object.assign({ id: U.uid(col.slice(0, 3)) }, obj, { createdAt: obj.createdAt || new Date().toISOString() });
      this.stampBranch(col, rec);
      const payload = col === 'users' ? this.staffPayload(rec, true) : Object.assign({ id: rec.id }, toPB(col, rec));
      const saved = await this.enqueue(() => pb.collection(col === 'users' ? 'staff' : col).create(payload), col.replace(/s$/, ''));
      let o = toApp(col, saved);
      const arr = this.raw(col);
      const have = arr.find((x) => x.id === o.id); // the realtime event can arrive before the reply
      if (have) o = Object.assign(have, o); else arr.push(o);
      this.changed();
      this.snap[col] = this.snap[col] || {};
      this.snap[col][o.id] = sig(col, o);
      this.audit('create', col, o.id);
      this.persist();
      return o;
    },

    stampBranch(col, rec) {
      if (global.Branch && Branch.OWNED.indexOf(col) >= 0 && col !== 'transfers' && rec.branchId === undefined) rec.branchId = Branch.workId();
    },

    staffPayload(o, isNew) {
      const p = toPB('users', o);
      if (o.password) { p.password = o.password; p.passwordConfirm = o.password; }
      if (isNew) p.id = o.id;
      return p;
    },

    insert(col, obj) {
      this.changed();
      const rec = Object.assign({ id: U.uid(col.slice(0, 3)) }, obj, { createdAt: obj.createdAt || new Date().toISOString() });
      this.stampBranch(col, rec);
      if (col === 'users') {
        const password = rec.password;
        delete rec.password;
        this.raw(col).push(rec);
        this.snap.users = this.snap.users || {};
        this.snap.users[rec.id] = sig('users', rec);
        this.enqueue(() => pb.collection('staff').create(this.staffPayload(Object.assign({}, rec, { password }), true)), 'user')
          .then((saved) => { Object.assign(rec, toApp('users', saved)); this.snap.users[rec.id] = sig('users', rec); })
          .catch(() => this.removeLocal('users', rec.id));
        return rec;
      }
      this.raw(col).push(rec);
      this.snap[col] = this.snap[col] || {};
      this.snap[col][rec.id] = sig(col, rec);
      this.enqueue(() => pb.collection(col).create(Object.assign({ id: rec.id }, toPB(col, rec))), col.replace(/s$/, ''))
        .then((saved) => { Object.assign(rec, toApp(col, saved)); this.snap[col][rec.id] = sig(col, rec); })
        .catch(() => this.removeLocal(col, rec.id));
      this.audit('create', col, rec.id);
      this.persist(); // also save anything the caller changed in place just before
      return rec;
    },

    update(col, id, patch) {
      this.changed();
      const rec = this.raw(col).find((x) => x.id === id);
      if (!rec) return null;
      const password = patch && patch.password;
      if (patch) { patch = Object.assign({}, patch); delete patch.password; }
      Object.assign(rec, patch, { updatedAt: new Date().toISOString() });
      if (col === 'users') {
        this.snap.users[id] = sig('users', rec);
        const p = this.staffPayload(Object.assign({}, rec, { password }), false);
        this.enqueue(() => pb.collection('staff').update(id, p), 'user').catch(() => this.reloadRecord('users', id));
        return rec;
      }
      this.pushUpdate(col, rec);
      this.audit('update', col, id);
      this.persist();
      return rec;
    },

    pushUpdate(col, rec) {
      const s = sig(col, rec);
      if (this.snap[col] && this.snap[col][rec.id] === s) return;
      (this.snap[col] = this.snap[col] || {})[rec.id] = s;
      const body = JSON.parse(s);
      this.enqueue(() => pb.collection(col).update(rec.id, body), col.replace(/s$/, '')).catch(() => this.reloadRecord(col, rec.id));
    },

    remove(col, id) {
      this.removeLocal(col, id);
      this.enqueue(() => pb.collection(col === 'users' ? 'staff' : col).delete(id), col.replace(/s$/, '')).catch(() => this.reloadCollection(col));
      this.audit('delete', col, id);
    },

    removeLocal(col, id) {
      this.changed();
      const arr = this.raw(col);
      const i = arr.findIndex((x) => x.id === id);
      if (i >= 0) arr.splice(i, 1);
      if (this.snap[col]) delete this.snap[col][id];
    },

    // Saves every record changed in place since the last sync (and the settings)
    persist() {
      this.changed();
      Object.keys(this.data).forEach((col) => {
        if (col === 'settings' || col === 'users' || !Array.isArray(this.data[col]) || !this.snap[col]) return;
        const arr = this.data[col];
        const marked = this.dirty[col] || new Set();
        if (arr.length <= FULL_CHECK_LIMIT) arr.forEach((r) => { if (this.snap[col][r.id] !== undefined) this.pushUpdate(col, r); });
        else marked.forEach((id) => { const r = arr.find((x) => x.id === id); if (r) this.pushUpdate(col, r); });
        marked.clear();
      });
      this.syncSettings();
      return true;
    },

    flush() { return this.queue; },

    // A record the server created or changed itself (e.g. a payment it recorded): add it to the screen copy
    ingest(col, r) {
      this.changed();
      const o = toApp(col, r);
      const arr = this.raw(col);
      const i = arr.findIndex((x) => x.id === o.id);
      if (i >= 0) arr[i] = Object.assign(arr[i], o); else arr.push(o);
      (this.snap[col] = this.snap[col] || {})[o.id] = sig(col, o);
      return arr.find((x) => x.id === o.id);
    },

    // Show a change the server makes by itself (e.g. a piece marked sold by a bill) without sending it
    setLocal(col, id, patch) {
      this.changed();
      const rec = this.raw(col).find((x) => x.id === id);
      if (!rec) return null;
      Object.assign(rec, patch);
      (this.snap[col] = this.snap[col] || {})[id] = sig(col, rec);
      return rec;
    },

    // Re-read matching records from the server (after the server changed them)
    async reloadWhere(col, filter) {
      try {
        const recs = await pb.collection(col).getFullList({ filter });
        recs.forEach((r) => this.ingest(col, r));
      } catch (e) { /* realtime will catch up */ }
    },

    async reloadRecord(col, id) {
      try {
        const r = await pb.collection(col === 'users' ? 'staff' : col).getOne(id);
        const o = toApp(col, r);
        const arr = this.raw(col);
        const i = arr.findIndex((x) => x.id === id);
        if (i >= 0) arr[i] = Object.assign(arr[i], o); else arr.push(o);
        this.snap[col][id] = sig(col, o);
      } catch (e) {
        this.removeLocal(col, id);
      }
      App.softRefresh();
    },

    async reloadCollection(col) {
      try {
        this.setCollection(col, await pb.collection(col === 'users' ? 'staff' : col).getFullList({ batch: 500, sort: 'created' }));
      } catch (e) { /* keep local */ }
      App.softRefresh();
    },

    // The activity log is written by the server (who did what, when); nothing to send from here
    audit() {},
    log() {},

    // Latest activity log entries (head office Admin only)
    async recentActivity(limit) {
      const res = await pb.collection('audit').getList(1, limit || 50, { sort: '-created' });
      return res.items.map((r) => r.data || {});
    },

    // ---- realtime: changes from other computers ----
    subscribe() {
      const handle = (col) => (e) => {
        const appCol = col === 'staff' ? 'users' : col;
        const arr = this.raw(appCol);
        const snaps = this.snap[appCol] = this.snap[appCol] || {};
        if (e.action === 'delete') {
          if (arr.some((x) => x.id === e.record.id)) { this.removeLocal(appCol, e.record.id); App.softRefresh(); }
          return;
        }
        const o = toApp(appCol, e.record);
        const s = sig(appCol, o);
        if (snaps[o.id] === s) return; // our own change coming back
        const i = arr.findIndex((x) => x.id === o.id);
        if (i >= 0) {
          Object.keys(arr[i]).forEach((k) => { if (!(k in o)) delete arr[i][k]; });
          Object.assign(arr[i], o);
        } else {
          arr.push(o);
        }
        snaps[o.id] = s;
        this.changed();
        App.softRefresh();
      };
      COLLECTIONS.concat(['staff']).forEach((col) => { pb.collection(col).subscribe('*', handle(col)).catch(() => {}); });
      pb.collection('appSettings').subscribe('main', (e) => {
        const now = JSON.stringify(e.record.data || {});
        if (now === this.snap.settings) return;
        this.data.settings = e.record.data || {};
        this.snap.settings = now;
        App.softRefresh(true);
      }).catch(() => {});
    },

    // ---- rates and derived balances (unchanged from the prototype) ----
    rateHistory() {
      return this.memo('rates', () => this.all('rates').slice().sort((a, b) => new Date(a.at) - new Date(b.at)));
    },

    latestRate() {
      const h = this.rateHistory();
      return h.length ? h[h.length - 1] : { values: {}, at: null };
    },

    currentRates() {
      return this.latestRate().values || {};
    },

    customerSummary(customerId) {
      // bills and receipts grouped by customer once, instead of scanning everything per customer
      const byCust = this.memo('cust:' + (global.Branch ? Branch.viewId() : ''), () => {
        const m = new Map();
        const slot = (id) => { let x = m.get(id); if (!x) { x = { invs: [], receipts: [] }; m.set(id, x); } return x; };
        this.all('invoices').forEach((i) => { if (i.status !== 'CANCELLED') slot(i.customerId).invs.push(i); });
        this.all('receipts').forEach((r) => slot(r.customerId).receipts.push(r));
        return m;
      });
      const g = byCust.get(customerId) || { invs: [], receipts: [] };
      const invs = g.invs;
      const receipts = g.receipts;
      const billed = U.sum(invs, 'grandTotal');
      const paidAtBill = U.sum(invs, 'paid');
      const received = U.sum(receipts, 'amount');
      const lastVisit = invs.map((i) => i.date).sort().pop() || '';
      return { invoices: invs, receipts, billed, paid: paidAtBill + received, outstanding: U.r2(billed - paidAtBill - received), lastVisit };
    },

    vendorSummary(vendorId) {
      const v = this.get('vendors', vendorId) || {};
      const purchases = this.all('purchases').filter((p) => p.vendorId === vendorId);
      const payments = this.all('vendorPayments').filter((p) => p.vendorId === vendorId);
      const purchased = U.sum(purchases, 'total');
      const paid = U.sum(purchases, 'paid') + U.sum(payments, 'amount');
      return { purchases, payments, purchased, paid, payable: U.r2(U.n(v.openingBalance) + purchased - paid) };
    },

    name(col, id, field) {
      const r = this.get(col, id);
      return r ? r[field || 'name'] : '';
    },

    // Calls the JewelleryApp server routes (/api/jw/...)
    api(path, opts) {
      return pb.send('/api/jw/' + path, Object.assign({ method: 'GET' }, opts || {}));
    },

    errorText,
  };

  global.DB = DB;
})(window);
