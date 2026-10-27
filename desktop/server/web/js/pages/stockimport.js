/* Stock bulk upload: download an Excel template pre-filled from the item master (only tag no and
 * weight left to type), then upload it to add every piece at once. Every row is checked before
 * anything is saved, so a file with a mistake adds nothing until it is fixed. */
(function (global) {
  'use strict';
  const esc = U.esc;
  const MAX_ROWS = 5000;

  // Template columns, in order. input = the yellow cells the shop fills in.
  const COLS = [
    { key: 'itemCode', label: 'Item code', w: 12 },
    { key: 'itemName', label: 'Item name', w: 24 },
    { key: 'tagNo', label: 'Tag no (blank = automatic)', w: 15, input: true },
    { key: 'grossWt', label: 'Gross weight (g)', w: 12, input: true, num: true, wt: true },
    { key: 'stoneWt', label: 'Stone weight (g)', w: 12, num: true, wt: true },
    { key: 'netWt', label: 'Net weight (g) (blank = gross - stone)', w: 15, num: true, wt: true },
    { key: 'purity', label: 'Purity', w: 13 },
    { key: 'qty', label: 'Quantity (pcs)', w: 10, num: true },
    { key: 'huid', label: 'HUID', w: 10 },
    { key: 'stoneDetails', label: 'Stone details', w: 22 },
    { key: 'stoneValue', label: 'Stone value (Rs)', w: 12, num: true },
    { key: 'otherCharges', label: 'Hallmark / other charges (Rs)', w: 14, num: true },
    { key: 'makingType', label: 'Making type', w: 18 },
    { key: 'makingValue', label: 'Making value', w: 11, num: true },
    { key: 'wastagePct', label: 'Wastage %', w: 10, num: true },
    { key: 'fixedPrice', label: 'Fixed price / MRP (Rs)', w: 13, num: true },
    { key: 'size', label: 'Size / length', w: 11 },
    { key: 'vendor', label: 'Vendor', w: 20 },
    { key: 'costPrice', label: 'Purchase cost (Rs)', w: 12, num: true },
    { key: 'location', label: 'Location', w: 15 },
    { key: 'receivedOn', label: 'Received on', w: 12 },
  ];
  const at = (key) => COLS.findIndex((c) => c.key === key);
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/₹/g, 'rs').replace(/[^a-z0-9%]+/g, ' ').trim();
  const HEAD = {};
  COLS.forEach((c) => { HEAD[norm(c.label)] = c.key; });
  Object.assign(HEAD, { 'tag': 'tagNo', 'tag no': 'tagNo', 'barcode': 'tagNo', 'item': 'itemCode', 'gross weight': 'grossWt', 'net weight': 'netWt', 'stone weight': 'stoneWt', 'weight': 'grossWt' });

  const makingLabel = (v) => (Pricing.MAKING_TYPES.find((m) => m.value === v) || {}).label || '';
  const findBy = (list, v, ...keys) => {
    const t = String(v).trim().toLowerCase();
    return list.find((r) => keys.some((k) => String(r[k] || '').toLowerCase() === t));
  };

  /* ---------- template ---------- */

  function template(opt) {
    const s = DB.settings;
    const items = DB.all('items').filter((i) => i.active !== false && (!opt.categoryId || i.categoryId === opt.categoryId))
      .sort((a, b) => (a.code < b.code ? -1 : 1));
    if (!items.length) { UI.toast('No active items in this category', 'error'); return; }
    const per = Math.min(50, Math.max(1, parseInt(opt.perItem, 10) || 1));
    if (items.length * per > MAX_ROWS) { UI.toast('That makes more than ' + MAX_ROWS + ' rows; choose a category or fewer pieces per item', 'error'); return; }
    const vendor = DB.get('vendors', opt.vendorId);
    const rows = [COLS.map((c) => ({ v: c.label, s: 'head' }))];
    items.forEach((it) => {
      const fixed = it.pricing === 'FIXED';
      for (let k = 0; k < per; k++) {
        const r = rows.length + 1; // Excel row number of this row
        const v = {
          itemCode: it.code, itemName: it.name,
          tagNo: { v: '', s: 'input' },
          grossWt: fixed ? { v: '', s: 'wt' } : { v: '', s: 'inputWt' },
          stoneWt: { v: 0, s: 'wt' },
          netWt: { f: 'IF(D' + r + '="","",D' + r + '-E' + r + ')', s: 'wt' },
          purity: DB.name('purities', it.purityId) || '',
          qty: 1, huid: '', stoneDetails: '', stoneValue: '',
          otherCharges: U.n(s.hallmarkCharge) || '',
          makingType: makingLabel(it.makingType), makingValue: it.makingValue == null ? '' : it.makingValue,
          wastagePct: it.wastagePct == null ? '' : it.wastagePct,
          fixedPrice: fixed ? { v: '', s: 'input' } : '',
          size: '', vendor: vendor ? vendor.name : '', costPrice: '',
          location: opt.location || 'Counter 1',
          receivedOn: { v: opt.receivedOn || U.today(), s: 'date' },
        };
        rows.push(COLS.map((c) => v[c.key]));
      }
    });
    // Dropdown lists live on a hidden sheet so long vendor lists still fit
    const lists = [
      ['Purity'].concat(DB.all('purities').map((p) => p.name)),
      ['Making type'].concat(Pricing.MAKING_TYPES.map((m) => m.label)),
      ['Location'].concat(StockUI.LOCATIONS),
      ['Vendor'].concat(DB.all('vendors').map((x) => x.name).sort()),
      ['Item code'].concat(DB.all('items').filter((i) => i.active !== false).map((i) => i.code).sort()),
    ];
    const listRows = [];
    const longest = Math.max(...lists.map((l) => l.length));
    for (let i = 0; i < longest; i++) listRows.push(lists.map((l) => (l[i] == null ? '' : l[i])));
    const ref = (j) => 'Lists!$' + Xlsx.colName(j) + '$2:$' + Xlsx.colName(j) + '$' + Math.max(2, lists[j].length);
    const dropdowns = [['purity', 0], ['makingType', 1], ['location', 2], ['vendor', 3], ['itemCode', 4]]
      .filter(([, j]) => lists[j].length > 1).map(([k, j]) => ({ col: at(k), ref: ref(j) }));
    const help = [
      [{ v: 'How to fill this sheet', s: 'head' }],
      ['1. Each row on the Stock sheet is one piece. The rows are already filled from your item master.'],
      ['2. Type only the yellow cells: Tag no (or leave it blank for an automatic tag) and Gross weight.'],
      ['3. Net weight is worked out as gross - stone. Type a stone weight or net weight only when the piece has stones.'],
      ['4. Fixed price items have a yellow Fixed price / MRP cell instead of a weight.'],
      ['5. Rows left without a tag, weight, HUID or price are skipped, so unused rows can stay.'],
      ['6. For more pieces of the same item, copy a row and paste it below. Keep the first row (the headings) as it is.'],
      ['7. Purity, making type, vendor and location have drop-down lists. Blank making, wastage and charges use the item defaults.'],
      ['8. Save the file and upload it in the app: Stock > Bulk upload (Excel) > Upload filled file.'],
      ['The app checks every row first. If any row has a problem nothing is added; it lists the rows to fix.'],
    ];
    const cat = DB.get('categories', opt.categoryId);
    const data = Xlsx.write([
      { name: 'Stock', rows, widths: COLS.map((c) => c.w), freeze: true, lists: dropdowns },
      { name: 'How to fill', rows: help, widths: [110] },
      { name: 'Lists', rows: listRows, hidden: true },
    ]);
    U.download('stock-upload-' + (cat ? cat.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() + '-' : '') + U.today() + '.xlsx', data, Xlsx.MIME);
    UI.toast('Template downloaded with ' + (rows.length - 1) + ' rows');
  }

  /* ---------- reading the filled file ---------- */

  function toNum(v) {
    if (v === '' || v == null) return '';
    if (typeof v === 'number') return v;
    const t = String(v).replace(/,/g, '').replace(/^(rs\.?|₹)\s*/i, '').replace(/\s*(g|gm|gms|grams?)$/i, '').trim();
    if (t === '') return '';
    return /^-?\d*\.?\d+$/.test(t) ? parseFloat(t) : NaN;
  }

  function toDate(v) {
    if (v === '' || v == null) return '';
    if (typeof v === 'number') return v > 20000 && v < 80000 ? Xlsx.serialToISO(v) : null;
    const t = String(v).trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
    if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
    if (!m) return null;
    // day first (Indian order) unless that cannot be a date, e.g. 10/27/2026 from a US-set computer
    let [day, mon] = [+m[1], +m[2]];
    if (mon > 12 && day <= 12) [day, mon] = [mon, day];
    if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
    return m[3] + '-' + String(mon).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  // rows from the file -> { pieces: [{ row, d }], errors: [{ row, msg }], skipped }
  function check(rows) {
    const out = { pieces: [], errors: [], skipped: 0 };
    const hi = rows.findIndex((r) => r.some((c) => HEAD[norm(c)] === 'itemCode'));
    if (hi < 0) { out.errors.push({ row: 1, msg: 'No "Item code" heading found. Use the template from this screen.' }); return out; }
    const map = {};
    rows[hi].forEach((c, j) => { const k = HEAD[norm(c)]; if (k && map[k] == null) map[k] = j; });
    if (map.grossWt == null && map.netWt == null && map.fixedPrice == null) { out.errors.push({ row: hi + 1, msg: 'No weight column found. Use the template from this screen.' }); return out; }
    const body = rows.slice(hi + 1);
    if (body.length > MAX_ROWS) { out.errors.push({ row: hi + 2, msg: 'The file has more than ' + MAX_ROWS + ' rows; split it into smaller files.' }); return out; }
    const stock = DB.raw('stock');
    const huids = new Map(stock.filter((s) => s.huid).map((s) => [String(s.huid).toUpperCase(), s.tagNo]));
    const seenTag = {};
    const seenHuid = {};
    const purities = DB.all('purities');
    const vendors = DB.all('vendors');
    const items = DB.all('items');
    body.forEach((r, i) => {
      const rowNo = hi + i + 2;
      const g = (k) => { const v = map[k] == null ? '' : r[map[k]]; return typeof v === 'string' ? v.trim() : v == null ? '' : v; };
      const used = ['tagNo', 'grossWt', 'netWt', 'huid', 'fixedPrice'].some((k) => g(k) !== '');
      if (!used) { if (r.some((c) => c !== '' && c != null)) out.skipped++; return; }
      const errs = [];
      const fail = (m) => errs.push(m);
      const item = g('itemCode') === '' ? null : findBy(items, g('itemCode'), 'code');
      if (!item) { out.errors.push({ row: rowNo, msg: g('itemCode') === '' ? 'Item code is empty' : 'Item code "' + g('itemCode') + '" is not in the item master' }); return; }
      const d = { itemId: item.id, tagNo: String(g('tagNo')), huid: String(g('huid')).toUpperCase() };
      ['grossWt', 'stoneWt', 'netWt', 'qty', 'stoneValue', 'otherCharges', 'makingValue', 'wastagePct', 'fixedPrice', 'costPrice'].forEach((k) => {
        const n = toNum(g(k));
        const label = COLS[at(k)].label.replace(/ \(.*$/, '');
        if (Number.isNaN(n)) fail(label + ' "' + g(k) + '" is not a number');
        else if (n !== '' && n < 0) fail(label + ' cannot be negative');
        d[k] = Number.isNaN(n) ? '' : n;
      });
      ['grossWt', 'stoneWt', 'netWt'].forEach((k) => { if (d[k] !== '') d[k] = U.r3(d[k]); });
      if (d.grossWt !== '' && U.n(d.stoneWt) > d.grossWt) fail('Stone weight cannot be more than gross weight');
      else if (d.netWt === '' && d.grossWt !== '') d.netWt = U.r3(d.grossWt - U.n(d.stoneWt));
      if (d.stoneWt === '') d.stoneWt = 0;
      if (d.qty === '') d.qty = 1;
      else if (!Number.isInteger(d.qty) || d.qty < 1) fail('Quantity must be a whole number of 1 or more');
      if (g('purity') === '') d.purityId = item.purityId || '';
      else {
        const p = findBy(purities, g('purity'), 'name', 'id');
        if (p) d.purityId = p.id; else fail('Purity "' + g('purity') + '" is not in the purity master');
      }
      d.makingType = '';
      if (g('makingType') !== '') {
        const m = Pricing.MAKING_TYPES.find((x) => [x.value, x.label].some((t) => norm(t) === norm(g('makingType'))));
        if (m) d.makingType = m.value; else fail('Making type "' + g('makingType') + '" should be one of: ' + Pricing.MAKING_TYPES.map((x) => x.label).join(', '));
      }
      // values equal to the item's defaults stay blank, so later changes to the item still apply
      if (d.makingType === item.makingType) d.makingType = '';
      if (d.makingValue !== '' && d.makingValue === U.n(item.makingValue)) d.makingValue = '';
      if (d.wastagePct !== '' && d.wastagePct === U.n(item.wastagePct)) d.wastagePct = '';
      d.vendorId = '';
      if (g('vendor') !== '') {
        const v = findBy(vendors, g('vendor'), 'name');
        if (v) d.vendorId = v.id; else fail('Vendor "' + g('vendor') + '" is not in Vendors; add it there first');
      }
      d.location = 'Counter 1';
      if (g('location') !== '') {
        const l = StockUI.LOCATIONS.find((x) => x.toLowerCase() === String(g('location')).toLowerCase());
        if (l) d.location = l; else fail('Location "' + g('location') + '" should be one of: ' + StockUI.LOCATIONS.join(', '));
      }
      const day = toDate(g('receivedOn'));
      if (day === null) fail('Received on "' + g('receivedOn') + '" is not a date (use DD-MM-YYYY)');
      else d.receivedOn = day || U.today();
      d.stoneDetails = String(g('stoneDetails'));
      d.size = String(g('size'));
      if (!errs.length) {
        const err = StockUI.validatePiece(d, null);
        if (err) fail(err);
      }
      if (d.tagNo) {
        const t = d.tagNo.toLowerCase();
        if (seenTag[t]) fail('Tag ' + d.tagNo + ' is also on row ' + seenTag[t]);
        else seenTag[t] = rowNo;
      }
      if (d.huid) {
        if (seenHuid[d.huid]) fail('HUID ' + d.huid + ' is also on row ' + seenHuid[d.huid]);
        else seenHuid[d.huid] = rowNo;
        if (huids.has(d.huid)) fail('HUID ' + d.huid + ' is already on piece ' + huids.get(d.huid));
      }
      if (errs.length) errs.forEach((m) => out.errors.push({ row: rowNo, msg: m }));
      else out.pieces.push({ row: rowNo, d });
    });
    return out;
  }

  /* ---------- the dialog ---------- */

  function open(onDone) {
    const fields = [
      { name: 'categoryId', label: 'Items from category', type: 'select', options: () => [{ value: '', label: 'All categories' }].concat(DB.all('categories').map((c) => ({ value: c.id, label: c.name }))) },
      { name: 'perItem', label: 'Rows per item', type: 'number', min: 1, max: 50, default: 1, help: 'More rows for items you received several of' },
      { name: 'vendorId', label: 'Vendor (optional)', type: 'select', options: () => DB.all('vendors').map((v) => ({ value: v.id, label: v.name })) },
      { name: 'location', label: 'Location', type: 'select', options: StockUI.LOCATIONS },
      { name: 'receivedOn', label: 'Received on', type: 'date' },
    ];
    let result = null;
    const m = UI.modal({
      title: 'Bulk upload stock from Excel', size: 'wide',
      body:
        '<h4 class="sub">1. Download the template</h4>' +
        '<p class="muted small">Every active item comes pre-filled with its purity, making charge, wastage and hallmark charge. You only type the tag no and gross weight (the yellow cells). Leave the tag blank for an automatic one.</p>' +
        UI.formHtml(fields, { perItem: 1, location: 'Counter 1', receivedOn: U.today() }) +
        '<div class="actions-row"><button class="btn" data-template>Download Excel template</button></div>' +
        '<h4 class="sub">2. Upload the filled file</h4>' +
        '<p class="muted small">Excel (.xlsx) or CSV. New pieces are added to the master branch as in stock. Every row is checked first; nothing is added until all rows are correct.</p>' +
        '<div class="actions-row"><label class="btn file-btn">Upload filled file<input type="file" accept=".xlsx,.csv,' + Xlsx.MIME + ',text/csv" data-file hidden></label><span class="muted small" data-fname></span></div>' +
        '<div data-result></div>',
      actions: [{ label: 'Close' }],
    });
    const el = m.el;
    const box = el.querySelector('[data-result]');
    el.querySelector('[data-template]').addEventListener('click', () => {
      const d = UI.readForm(el, fields);
      if (d) template(d);
    });
    const inp = el.querySelector('[data-file]');
    inp.addEventListener('change', async () => {
      const file = inp.files[0];
      inp.value = ''; // the same file can be chosen again after fixing it
      if (!file) return;
      el.querySelector('[data-fname]').textContent = file.name;
      if (file.size > 20 * 1024 * 1024) { UI.toast('The file is too large (over 20 MB)', 'error'); return; }
      box.innerHTML = '<p class="muted">Checking ' + esc(file.name) + '...</p>';
      try {
        result = check(await Xlsx.readFile(file, 'Stock'));
      } catch (e) {
        result = null;
        box.innerHTML = '<p class="error-text">' + esc(e.message || 'Could not read the file') + '</p>';
        return;
      }
      show();
    });

    function show() {
      const r = result;
      const skipped = r.skipped ? ' &middot; ' + r.skipped + ' blank row(s) skipped' : '';
      if (r.errors.length) {
        box.innerHTML = '<p class="error-text"><b>' + r.errors.length + ' problem(s) found. Nothing has been added.</b> Fix these rows in Excel, save, and upload again.</p>' +
          UI.table({ columns: [{ label: 'Excel row', key: 'row', align: 'right' }, { label: 'Problem', key: 'msg' }], rows: r.errors, limit: 200 }) +
          '<p class="muted small">' + r.pieces.length + ' row(s) are fine' + skipped + '.</p>';
        return;
      }
      if (!r.pieces.length) { box.innerHTML = '<p class="error-text">No pieces to add: every row is missing its tag and weight.</p>'; return; }
      const ps = r.pieces.map((p) => p.d);
      box.innerHTML = '<p><b>' + ps.length + ' piece(s) ready to add</b> &middot; Gross ' + U.wt(U.sum(ps, 'grossWt')) + ' &middot; Net ' + U.wt(U.sum(ps, 'netWt')) + skipped + '</p>' +
        UI.table({
          columns: [
            { label: 'Row', key: 'row', align: 'right' },
            { label: 'Item', render: (p) => esc(Biz.item(p.d.itemId).name) },
            { label: 'Tag', render: (p) => esc(p.d.tagNo || 'automatic') },
            { label: 'Purity', render: (p) => esc(Biz.purityName(p.d.purityId)) },
            { label: 'Gross g', align: 'right', render: (p) => U.num(p.d.grossWt) },
            { label: 'Net g', align: 'right', render: (p) => U.num(p.d.netWt) },
            { label: 'HUID', render: (p) => esc(p.d.huid) },
            { label: 'Location', render: (p) => esc(p.d.location) },
          ],
          rows: r.pieces, limit: 200,
        }) +
        '<div class="actions-row"><button class="btn primary" data-import>Add ' + ps.length + ' piece(s) to stock</button></div>';
      box.querySelector('[data-import]').addEventListener('click', save);
    }

    async function save(e) {
      const btn = e.target;
      btn.disabled = true;
      inp.disabled = true;
      const list = result.pieces;
      let done = 0;
      const branchId = Branch.masterId();
      for (const p of list) {
        btn.textContent = 'Adding ' + (done + 1) + ' of ' + list.length + '...';
        try {
          await DB.create('stock', Object.assign({}, p.d, { status: 'IN_STOCK', branchId }));
        } catch (err) {
          box.insertAdjacentHTML('afterbegin', '<p class="error-text"><b>Stopped at Excel row ' + p.row + '.</b> ' + done + ' piece(s) were added. ' +
            'Delete rows up to ' + (list[done - 1] ? list[done - 1].row : p.row - 1) + ' from the file before uploading it again, or those pieces will be added twice.</p>');
          btn.remove();
          inp.disabled = false;
          if (onDone) onDone();
          return;
        }
        done++;
      }
      UI.toast(done + ' piece(s) added to stock');
      if (onDone) onDone();
      m.close();
    }
  }

  global.StockImport = { open, check, template, COLS };
})(window);
