/* Stock: every tagged piece with weights, HUID, vendor, location and value at today's rate */
(function (global) {
  'use strict';
  const esc = U.esc;

  const itemOptions = () => DB.all('items').filter((i) => i.active !== false)
    .sort((a, b) => (a.code < b.code ? -1 : 1)).map((i) => ({ value: i.id, label: i.code + ' - ' + i.name }));

  function pieceFields() {
    return [
      { name: 'itemId', label: 'Item', type: 'select', required: true, options: itemOptions, full: true },
      { name: 'tagNo', label: 'Tag / barcode no.', help: 'Leave blank to auto-generate' },
      { name: 'huid', label: 'HUID (BIS hallmark)', maxlength: 6, help: '6-character hallmark unique ID' },
      { name: 'purityId', label: 'Purity', type: 'select', options: () => DB.all('purities').map((p) => ({ value: p.id, label: p.name })) },
      { name: 'qty', label: 'Quantity (pcs)', type: 'number', min: 1, default: 1 },
      { name: 'grossWt', label: 'Gross weight (g)', type: 'number', min: 0, step: '0.001' },
      { name: 'stoneWt', label: 'Stone / less weight (g)', type: 'number', min: 0, step: '0.001' },
      { name: 'netWt', label: 'Net weight (g)', type: 'number', min: 0, step: '0.001', help: 'Auto = gross - stone' },
      { name: 'stoneDetails', label: 'Stone details', placeholder: 'e.g. 0.24 ct VS-GH diamonds' },
      { name: 'stoneValue', label: 'Stone value (₹)', type: 'number', min: 0 },
      { name: 'otherCharges', label: 'Hallmark / other charges (₹)', type: 'number', min: 0 },
      { name: 'makingType', label: 'Making type (blank = item default)', type: 'select', options: Pricing.MAKING_TYPES },
      { name: 'makingValue', label: 'Making value (blank = item default)', type: 'number', min: 0 },
      { name: 'wastagePct', label: 'Wastage % (blank = item default)', type: 'number', min: 0 },
      { name: 'fixedPrice', label: 'Fixed price / MRP (₹)', type: 'number', min: 0, help: 'Only for fixed price items' },
      { name: 'size', label: 'Size / length' },
      { name: 'vendorId', label: 'Vendor', type: 'select', options: () => DB.all('vendors').map((v) => ({ value: v.id, label: v.name })) },
      { name: 'costPrice', label: 'Purchase cost (₹)', type: 'number', min: 0 },
      { name: 'location', label: 'Location', type: 'select', options: ['Counter 1', 'Counter 2', 'Counter 3', 'Locker', 'Display Window', 'Repair / Karigar'] },
      { name: 'receivedOn', label: 'Received on', type: 'date' },
    ];
  }

  function bindPieceForm(el) {
    const f = (n) => el.querySelector('[name="' + n + '"]');
    const recalc = () => { f('netWt').value = U.r3(U.n(f('grossWt').value) - U.n(f('stoneWt').value)); };
    f('grossWt').addEventListener('input', recalc);
    f('stoneWt').addEventListener('input', recalc);
    f('itemId').addEventListener('change', () => {
      const it = DB.get('items', f('itemId').value);
      if (it) f('purityId').value = it.purityId || '';
    });
  }

  function validatePiece(d, rec) {
    const item = DB.get('items', d.itemId);
    if (!item) return 'Choose an item';
    if (item.pricing === 'WEIGHT' && !(U.n(d.netWt) > 0)) return 'Net weight is required for weight based items';
    if (item.pricing === 'WEIGHT' && !d.purityId) return 'Choose a purity';
    if (item.pricing === 'FIXED' && !(U.n(d.fixedPrice) > 0)) return 'Enter the fixed price / MRP';
    if (U.n(d.stoneWt) > U.n(d.grossWt) && U.n(d.grossWt) > 0) return 'Stone weight cannot exceed gross weight';
    if (d.huid && !/^[A-Z0-9]{6}$/i.test(d.huid)) return 'HUID must be 6 letters/digits';
    d.huid = (d.huid || '').toUpperCase();
    if (d.tagNo) {
      const dup = DB.raw('stock').find((s) => s.tagNo.toLowerCase() === d.tagNo.toLowerCase() && (!rec || s.id !== rec.id)); // unique across branches
      if (dup) return 'Tag ' + d.tagNo + ' already exists';
    } else {
      d.tagNo = DB.nextTag();
    }
    if (!d.qty) d.qty = 1;
    return null;
  }

  function openPiece(rec, onSave) {
    const fields = pieceFields();
    const values = rec ? Object.assign({}, rec) : { qty: 1, receivedOn: U.today(), location: 'Counter 1', otherCharges: DB.settings.hallmarkCharge, purityId: 'G22K' };
    UI.modal({
      title: rec ? 'Edit piece ' + rec.tagNo : 'Add stock piece', size: 'wide',
      body: UI.formHtml(fields, values),
      onOpen: bindPieceForm,
      actions: [{ label: 'Cancel' }, {
        label: 'Save', cls: 'btn primary', onClick: (el) => {
          const d = UI.readForm(el, fields);
          if (!d) return false;
          const err = validatePiece(d, rec);
          if (err) { UI.toast(err, 'error'); return false; }
          if (rec) DB.update('stock', rec.id, d);
          else DB.insert('stock', Object.assign(d, { status: 'IN_STOCK', branchId: Branch.masterId() })); // new stock arrives at the master branch
          UI.toast('Piece ' + d.tagNo + ' saved');
          onSave();
        },
      }],
    });
  }

  Pages.register({
    id: 'stock', title: 'Stock', icon: '&#9670;',
    render(el) {
      // Only the master branch adds, edits and transfers stock; branches sell what they are sent
      const canEdit = Auth.can(['Admin', 'Manager']) && Branch.isMaster();
      const allView = Branch.viewId() === 'ALL';
      const state = { q: '', cat: '', purity: '', status: 'IN_STOCK', loc: '' };
      const selected = new Set(); // pieces ticked for QR sticker printing
      el.innerHTML =
        '<section class="card">' +
        '<div class="toolbar wrap">' +
        '<input type="search" data-f="q" placeholder="Search tag, HUID, item...">' +
        '<select data-f="cat"><option value="">All categories</option>' + DB.all('categories').map((c) => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') + '</select>' +
        '<select data-f="purity"><option value="">All purities</option>' + DB.all('purities').map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('') + '</select>' +
        '<select data-f="status"><option value="IN_STOCK">In stock</option><option value="SOLD">Sold</option><option value="">All</option></select>' +
        '<span class="spacer"></span>' +
        '<button class="btn" data-transfers>Transfers</button>' +
        (canEdit ? '<button class="btn" data-transfer>Transfer to branch</button>' : '') +
        '<button class="btn" data-print>Print QR stickers</button>' +
        (canEdit ? '<a class="btn" href="#/purchases?new=1">Purchase entry</a><button class="btn primary" data-add>+ Add piece</button>' : '') +
        '</div><div class="stock-summary"></div><div class="stock-body"></div></section>';

      function filtered() {
        const q = state.q.toLowerCase();
        return DB.all('stock').filter((s) => {
          const it = Biz.item(s.itemId);
          if (state.status && s.status !== state.status) return false;
          if (state.cat && it.categoryId !== state.cat) return false;
          if (state.purity && s.purityId !== state.purity) return false;
          if (q && ![s.tagNo, s.huid, it.name, it.code, s.location, DB.name('vendors', s.vendorId)].some((v) => String(v || '').toLowerCase().includes(q))) return false;
          return true;
        }).sort((a, b) => (a.tagNo < b.tagNo ? -1 : 1));
      }

      function draw() {
        const rows = filtered();
        const rates = DB.currentRates();
        const value = U.sum(rows, (s) => Biz.pieceValue(s, rates));
        el.querySelector('.stock-summary').innerHTML =
          '<span><b>' + rows.length + '</b> pieces</span>' +
          '<span>Gross <b>' + U.wt(U.sum(rows, 'grossWt')) + '</b></span>' +
          '<span>Net <b>' + U.wt(U.sum(rows, 'netWt')) + '</b></span>' +
          '<span>Stone value <b>' + U.inr(U.sum(rows, 'stoneValue'), { whole: true }) + '</b></span>' +
          '<span>Value at today\'s rate <b>' + U.inr(value, { whole: true }) + '</b></span>' +
          '<span class="spacer"></span><span>' + (selected.size ? '<b>' + selected.size + '</b> ticked for stickers &middot; <a href="#" data-clear>clear</a>' : '<a href="#" data-selall>Tick all shown for stickers</a>') + '</span>';
        el.querySelector('[data-print]').textContent = 'Print QR stickers' + (selected.size ? ' (' + selected.size + ')' : '');
        const tb = el.querySelector('[data-transfer]');
        if (tb) tb.textContent = 'Transfer to branch' + (selected.size ? ' (' + selected.size + ')' : '');
        el.querySelector('.stock-body').innerHTML = UI.table({
          columns: [
            { label: '', render: (s) => (s.status === 'IN_STOCK' ? '<input type="checkbox" data-sel="' + s.id + '" title="Tick to print sticker"' + (selected.has(s.id) ? ' checked' : '') + '>' : '') },
            { label: 'Tag', render: (s) => '<b>' + esc(s.tagNo) + '</b>' },
            { label: 'Item', render: (s) => esc(Biz.item(s.itemId).name) + (s.stoneDetails ? '<br><small class="muted">' + esc(s.stoneDetails) + '</small>' : '') },
            { label: 'Purity', render: (s) => esc(Biz.purityName(s.purityId)) },
            { label: 'Gross (g)', align: 'right', render: (s) => U.num(s.grossWt) },
            { label: 'Net (g)', align: 'right', render: (s) => U.num(s.netWt) },
            { label: 'Stone ₹', align: 'right', render: (s) => (s.stoneValue ? U.inr(s.stoneValue, { whole: true }) : '-') },
            { label: 'HUID', key: 'huid' },
            { label: 'Vendor', render: (s) => esc(DB.name('vendors', s.vendorId)) },
            { label: 'Location', render: (s) => (allView ? '<b>' + esc(Branch.code(s.branchId)) + '</b> ' : '') + esc(s.location || '') },
            { label: 'Value today', align: 'right', render: (s) => U.inr(Biz.pieceValue(s, rates), { whole: true }) },
            { label: 'Status', render: (s) => (s.status === 'SOLD' ? UI.badge('Sold') : UI.badge('In stock', 'ok')) },
            {
              label: '', align: 'right', render: (s) => '<button class="icon-btn qr-btn" data-qr="' + s.id + '" title="QR code">&#9638;</button>' + (canEdit && s.status === 'IN_STOCK'
                ? '<button class="icon-btn" data-edit="' + s.id + '" title="Edit">&#9998;</button><button class="icon-btn danger" data-del="' + s.id + '" title="Delete">&#128465;</button>' : ''),
            },
          ],
          rows, empty: 'No stock matches these filters',
        });
      }

      el.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener('input', U.debounce(() => { state[inp.dataset.f] = inp.value.trim(); draw(); }, 120)));
      // Prints ticked pieces, or every in-stock piece currently shown when nothing is ticked
      el.querySelector('[data-print]').addEventListener('click', () => {
        const rows = selected.size ? DB.all('stock').filter((s) => selected.has(s.id)) : filtered().filter((s) => s.status === 'IN_STOCK');
        if (!rows.length) { UI.toast('No in-stock pieces to print', 'error'); return; }
        QR.printDialog(rows.sort((a, b) => (a.tagNo < b.tagNo ? -1 : 1)));
      });
      el.querySelector('[data-transfers]').addEventListener('click', () => transferHistory());
      const trb = el.querySelector('[data-transfer]');
      if (trb) trb.addEventListener('click', () => {
        const pcs = DB.all('stock').filter((s) => selected.has(s.id) && s.status === 'IN_STOCK');
        if (!pcs.length) { UI.toast('Tick the in-stock pieces to transfer first', 'error'); return; }
        transferDialog(pcs, () => { selected.clear(); draw(); });
      });
      el.querySelector('.stock-summary').addEventListener('click', (e) => {
        if (e.target.closest('[data-selall]')) { e.preventDefault(); filtered().filter((s) => s.status === 'IN_STOCK').forEach((s) => selected.add(s.id)); draw(); }
        if (e.target.closest('[data-clear]')) { e.preventDefault(); selected.clear(); draw(); }
      });
      const add = el.querySelector('[data-add]');
      if (add) add.addEventListener('click', () => openPiece(null, draw));
      el.querySelector('.stock-body').addEventListener('click', async (e) => {
        const sel = e.target.closest('[data-sel]');
        if (sel) { if (sel.checked) selected.add(sel.dataset.sel); else selected.delete(sel.dataset.sel); draw(); return; }
        const qr = e.target.closest('[data-qr]');
        if (qr) { QR.show(DB.get('stock', qr.dataset.qr)); return; }
        const ed = e.target.closest('[data-edit]');
        const del = e.target.closest('[data-del]');
        if (ed) openPiece(DB.get('stock', ed.dataset.edit), draw);
        if (del && await UI.confirm('Delete this stock piece?', 'Delete')) {
          DB.remove('stock', del.dataset.del);
          UI.toast('Piece deleted');
          draw();
        }
      });
      draw();
    },
  });

  /* ---------- stock transfers between branches (master branch only) ---------- */

  function transferDialog(pieces, onDone) {
    const branches = Branch.all().filter((b) => b.active !== false);
    const fields = [
      { name: 'toBranchId', label: 'Send to branch', type: 'select', required: true, options: branches.map((b) => ({ value: b.id, label: b.name + (b.type === 'MASTER' ? ' (master)' : '') })) },
      { name: 'date', label: 'Transfer date', type: 'date', required: true, default: U.today() },
      { name: 'note', label: 'Note (carrier, seal no., etc.)', full: true },
    ];
    const byFrom = U.groupBy(pieces, (p) => p.branchId);
    UI.modal({
      title: 'Transfer ' + pieces.length + ' piece(s) to a branch', size: 'wide',
      body: UI.formHtml(fields, { toBranchId: (branches.find((b) => b.type !== 'MASTER') || {}).id }) +
        '<h4 class="sub">Pieces</h4>' + UI.table({
          columns: [
            { label: 'Tag', key: 'tagNo' }, { label: 'Item', render: (s) => esc(Biz.item(s.itemId).name) },
            { label: 'Purity', render: (s) => esc(Biz.purityName(s.purityId)) },
            { label: 'Gross g', align: 'right', render: (s) => U.num(s.grossWt) }, { label: 'Net g', align: 'right', render: (s) => U.num(s.netWt) },
            { label: 'Now at', render: (s) => esc(Branch.name(s.branchId)) },
          ],
          rows: pieces,
        }) + '<p class="muted small">Total ' + pieces.length + ' pcs &middot; Gross ' + U.wt(U.sum(pieces, 'grossWt')) + ' &middot; Net ' + U.wt(U.sum(pieces, 'netWt')) +
        '. Within the same state, send the stock with the delivery challan printed after saving; a branch in another state needs a GST tax invoice.</p>',
      actions: [{ label: 'Cancel' }, {
        label: 'Transfer', cls: 'btn primary', onClick: (el) => {
          const d = UI.readForm(el, fields);
          if (!d) return false;
          const moving = pieces.filter((p) => p.branchId !== d.toBranchId);
          if (!moving.length) { UI.toast('All these pieces are already at ' + Branch.name(d.toBranchId), 'error'); return false; }
          // One transfer record per source branch
          let last = null;
          Object.keys(byFrom).forEach((from) => {
            const pcs = byFrom[from].filter((p) => p.branchId !== d.toBranchId);
            if (!pcs.length) return;
            last = DB.insert('transfers', {
              transferNo: DB.nextNo('transfer', 'TRF', d.date, from), date: d.date, fromBranchId: from, toBranchId: d.toBranchId,
              pieces: pcs.map((x) => ({ stockId: x.id, tagNo: x.tagNo, itemId: x.itemId, purityId: x.purityId, grossWt: x.grossWt, netWt: x.netWt })),
              count: pcs.length, grossWt: U.r3(U.sum(pcs, 'grossWt')), netWt: U.r3(U.sum(pcs, 'netWt')), status: 'COMPLETED', note: d.note, by: Auth.user.username,
            });
            pcs.forEach((p) => { p.branchId = d.toBranchId; p.location = 'Counter 1'; });
          });
          DB.persist();
          UI.toast(moving.length + ' piece(s) transferred to ' + Branch.name(d.toBranchId));
          if (onDone) onDone();
          if (last) UI.confirm('Print the delivery challan for ' + last.transferNo + '?', 'Print challan').then((yes) => { if (yes) printChallan(last); });
        },
      }],
    });
  }

  function challanHtml(t) {
    const s = DB.settings;
    const from = Branch.details(t.fromBranchId);
    const to = Branch.details(t.toBranchId);
    return '<div class="invoice"><header class="inv-head">' + (s.logo ? '<img src="' + esc(s.logo) + '" alt="" class="inv-logo">' : '') +
      '<div class="inv-shop"><h2>' + esc(s.shopName) + '</h2><p>GSTIN: ' + esc(from.gstin || '-') + '</p></div>' +
      '<div class="inv-title"><h3>DELIVERY CHALLAN</h3><p><b>' + esc(t.transferNo) + '</b><br>Date: ' + U.fmtDate(t.date) + '<br><small>Stock transfer between branches</small></p></div></header>' +
      '<section class="inv-parties"><div><h4>From</h4><p><b>' + esc(from.name) + '</b><br>' + esc(from.address) + '<br>' + esc(from.phone || '') + '</p></div>' +
      '<div><h4>To</h4><p><b>' + esc(to.name) + '</b><br>' + esc(to.address) + '<br>' + esc(to.phone || '') + '</p></div></section>' +
      '<table class="inv-table"><thead><tr><th>#</th><th>Tag</th><th>Item</th><th>Purity</th><th class="right">Gross g</th><th class="right">Net g</th></tr></thead><tbody>' +
      t.pieces.map((p, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(p.tagNo) + '</td><td>' + esc(Biz.item(p.itemId).name) + '</td><td>' + esc(Biz.purityName(p.purityId)) +
        '</td><td class="right">' + U.num(p.grossWt) + '</td><td class="right">' + U.num(p.netWt) + '</td></tr>').join('') +
      '<tr><td></td><td colspan="3"><b>Total ' + t.count + ' pcs</b></td><td class="right"><b>' + U.num(t.grossWt) + '</b></td><td class="right"><b>' + U.num(t.netWt) + '</b></td></tr></tbody></table>' +
      (t.note ? '<p><b>Note:</b> ' + esc(t.note) + '</p>' : '') +
      '<p class="small">Goods sent for stock transfer between branches of the same business; not a sale.</p>' +
      '<footer class="inv-foot"><div class="terms">Sent by: ' + esc(t.by || '') + '</div><div class="sign"><span>Received by (branch)</span><span>For ' + esc(s.shopName) + '<br><br>Authorised signatory</span></div></footer></div>';
  }

  function printChallan(t) { UI.print('<style>@page { size: A4; margin: 10mm; }</style>' + challanHtml(t)); }

  function transferHistory() {
    const rows = DB.all('transfers').slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.transferNo < b.transferNo ? 1 : -1)));
    const m = UI.modal({
      title: 'Stock transfers' + (Branch.viewId() === 'ALL' ? '' : ' - ' + Branch.viewLabel()), size: 'wide',
      body: UI.table({
        columns: [
          { label: 'Transfer no', render: (t) => '<b>' + esc(t.transferNo) + '</b>' }, { label: 'Date', render: (t) => U.fmtDate(t.date) },
          { label: 'From', render: (t) => esc(Branch.name(t.fromBranchId)) }, { label: 'To', render: (t) => esc(Branch.name(t.toBranchId)) },
          { label: 'Pcs', align: 'right', key: 'count' }, { label: 'Net g', align: 'right', render: (t) => U.num(t.netWt) },
          { label: 'Note', key: 'note' }, { label: '', align: 'right', render: (t) => '<button class="btn sm" data-challan="' + t.id + '">Challan</button>' },
        ],
        rows, empty: 'No stock transfers yet',
      }),
    });
    m.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-challan]');
      if (b) printChallan(DB.get('transfers', b.dataset.challan));
    });
  }

  global.StockUI = { openPiece, validatePiece, transferDialog, transferHistory };
})(window);
