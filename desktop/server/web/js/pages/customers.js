/* Customers (CRM): customer list, profile with purchase history, dues and payment receipts */
(function (global) {
  'use strict';
  const esc = U.esc;

  // The server gives the receipt its number; returns null if it could not be saved
  async function saveReceipt(customer, d) {
    d.customerId = customer.id;
    // Booked at the customer's own branch so each branch's dues and receipts stay together
    // (head office Sales record receipts at head office)
    d.branchId = Branch.isMaster() && !Auth.can(['Admin', 'Manager']) ? Branch.userBranchId() : customer.branchId || Branch.workId();
    d.by = Auth.user.username;
    let rec;
    try {
      rec = await DB.create('receipts', d);
    } catch (e) {
      return null;
    }
    // the server settles the oldest bills with a balance; fetch the updated bills
    await DB.reloadWhere('invoices', DB.pb.filter('data.customerId = {:c}', { c: customer.id }));
    UI.toast('Receipt ' + rec.receiptNo + ' saved');
    return rec;
  }

  function receivePayment(customer, onDone) {
    const sum = DB.customerSummary(customer.id);
    const fields = [
      { name: 'date', label: 'Date', type: 'date', required: true, default: U.today() },
      { name: 'amount', label: 'Amount received (\u20B9)', type: 'number', required: true, min: 1, default: sum.outstanding > 0 ? sum.outstanding : '' },
      { name: 'mode', label: 'Mode', type: 'select', required: true, options: DB.all('paymentModes').filter((m) => m.active !== false).map((m) => m.name) },
      { name: 'ref', label: 'Reference / UTR / Cheque no.' },
      { name: 'notes', label: 'Notes', full: true },
    ];
    const actions = [{ label: 'Cancel' }];
    if (PG.enabled()) {
      actions.push({
        label: 'Collect online', cls: 'btn', onClick: (el) => {
          const d = UI.readForm(el, fields);
          if (!d) return false;
          if (d.amount <= 0) { UI.toast('Amount must be positive', 'error'); return false; }
          PG.collect({ amount: d.amount, customer, purpose: 'Due payment', description: 'Payment towards dues' }).then(async (pay) => {
            if (!pay) return;
            const r = await saveReceipt(customer, Object.assign(d, { mode: PG.modeName(pay), ref: pay.paymentId, gatewayRecId: pay.id }));
            if (!r) { UI.toast('Payment ' + pay.paymentId + ' was received but the receipt could not be saved. Note the payment ID and add the receipt manually.', 'error'); return; }
            PG.link(pay.id, { receiptId: r.id, receiptNo: r.receiptNo });
            if (onDone) onDone();
          });
        },
      });
    }
    actions.push({
      label: 'Save receipt', cls: 'btn primary', onClick: (el) => {
        const d = UI.readForm(el, fields);
        if (!d) return false;
        if (d.amount <= 0) { UI.toast('Amount must be positive', 'error'); return false; }
        return saveReceipt(customer, d).then((r) => {
          if (!r) return false;
          if (onDone) onDone();
        });
      },
    });
    UI.modal({
      title: 'Receive payment - ' + customer.name,
      body: '<p class="muted">Outstanding: <b>' + U.inr(sum.outstanding) + '</b></p>' + UI.formHtml(fields, {}) +
        (PG.enabled() ? '<p class="muted small">"Collect online" opens the payment gateway (' + esc(PG.label()) + ') for this amount.</p>' : ''),
      actions,
    });
  }

  function profile(c, refresh) {
    const s = DB.customerSummary(c.id);
    const info = [
      ['Mobile', c.phone], ['Email', c.email], ['Group', DB.name('customerGroups', c.groupId)], ['City', c.city],
      ['Birthday', U.fmtDate(c.dob)], ['Anniversary', U.fmtDate(c.anniversary)], ['PAN', c.pan], ['GSTIN', c.gstin],
      ['Ring / bangle size', c.ringSize],
      ['Pawn loans', (() => { const a = Pawn.active().filter((p) => p.customerId === c.id); return a.length ? a.length + ' active: ' + a.map((p) => p.pawnNo).join(', ') : ''; })()],
      ['Address', [c.address, c.city, c.state].filter(Boolean).join(', ')], ['Notes', c.notes],
    ].filter((x) => x[1]);
    const history = s.invoices.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const m = UI.modal({
      title: c.name + ' (' + c.code + ')', size: 'wide',
      body:
        '<div class="kpis compact">' +
        '<div class="kpi"><span>Total purchases</span><b>' + U.inr(s.billed, { whole: true }) + '</b><small>' + s.invoices.length + ' bill(s)</small></div>' +
        '<div class="kpi"><span>Paid</span><b>' + U.inr(s.paid, { whole: true }) + '</b></div>' +
        '<div class="kpi ' + (s.outstanding > 0 ? 'warn' : '') + '"><span>Outstanding</span><b>' + U.inr(s.outstanding, { whole: true }) + '</b></div>' +
        '<div class="kpi"><span>Last visit</span><b>' + (s.lastVisit ? U.fmtDate(s.lastVisit) : '-') + '</b></div></div>' +
        '<dl class="info">' + info.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>' +
        '<h4 class="sub">Purchase history</h4>' +
        UI.table({
          columns: [
            { label: 'Invoice', render: (r) => '<a href="#/sales?open=' + r.id + '">' + esc(r.invoiceNo) + '</a>' },
            { label: 'Date', render: (r) => U.fmtDate(r.date) },
            { label: 'Items', render: (r) => esc(r.lines.map((l) => l.itemName).join(', ')) },
            { label: 'Amount', align: 'right', render: (r) => U.inr(r.grandTotal, { whole: true }) },
          ],
          rows: history, empty: 'No purchases yet',
        }) +
        (s.receipts.length ? '<h4 class="sub">Payments received</h4>' + UI.table({
          columns: [
            { label: 'Receipt', key: 'receiptNo' }, { label: 'Date', render: (r) => U.fmtDate(r.date) },
            { label: 'Mode', key: 'mode' }, { label: 'Ref', key: 'ref' },
            { label: 'Amount', align: 'right', render: (r) => U.inr(r.amount) },
          ],
          rows: s.receipts,
        }) : ''),
      actions: [
        { label: 'Close' },
        { label: 'Receive payment', cls: 'btn', onClick: () => { receivePayment(c, refresh); } },
      ].concat(Auth.can(['Admin']) && c.phone ? [{ label: 'WhatsApp', cls: 'btn', onClick: () => { WAUI.compose(c, 'customer'); } }] : []).concat([
        { label: 'New sale', cls: 'btn primary', onClick: () => { App.go('#/pos?customer=' + c.id); } },
      ]),
    });
    m.el.addEventListener('click', (e) => { if (e.target.closest('a[href^="#/"]')) m.close(); });
  }

  Pages.register({
    id: 'customers', title: 'Customers', icon: '&#9786;',
    render(el, params) {
      el.innerHTML = '<section class="card"><div class="crud"></div></section>';
      const crud = UI.crud(el.querySelector('.crud'), Object.assign({}, Schemas.customers, {
        columns: Schemas.customers.columns.concat(Branch.viewId() === 'ALL' ? [{ label: 'Branch', render: (r) => esc(r.branchId ? Branch.name(r.branchId) : 'All branches') }] : []),
        onRowClick: (c) => profile(c, () => crud.render()),
        rowActions: (r) => '<button class="btn sm" data-sale="' + r.id + '">Bill</button>',
      }));
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-sale]');
        if (b) { e.stopPropagation(); App.go('#/pos?customer=' + b.dataset.sale); }
      }, true);
      if (params.new) crud.openForm(null);
      if (params.open) { const c = DB.get('customers', params.open); if (c) profile(c, () => crud.render()); }
    },
  });

  global.CRM = { receivePayment, profile };
})(window);
