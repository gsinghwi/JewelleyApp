/* Pawn / Girvi: pledge jewellery against a loan, track interest and repayments, release items,
 * print the pawn ticket and a QR sticker for the packet the items are kept in. */
(function (global) {
  'use strict';
  const esc = U.esc;
  const ID_PROOFS = ['Aadhaar', 'PAN', 'Voter ID', 'Driving Licence', 'Passport'];
  const METHODS = [{ value: 'MONTHLY', label: 'Monthly (started month = full month)' }, { value: 'DAILY', label: 'Daily (exact days)' }];
  const custLabel = (c) => c.name + ' - ' + (c.phone || c.code);
  const payModes = () => DB.all('paymentModes').filter((m) => m.active !== false).map((m) => m.name);
  const canAdmin = () => Auth.can(['Admin']);

  function statusBadge(p, c) {
    if (p.status === 'REDEEMED') return UI.badge('Redeemed', 'ok');
    if (p.status === 'FORFEITED') return UI.badge('Forfeited', 'err');
    c = c || Pawn.calc(p);
    return c.overdueDays > 0 ? UI.badge('Overdue ' + c.overdueDays + 'd', 'warn') : UI.badge('Active', 'gold');
  }

  // ---------------- new pawn ----------------

  function newPawn(onDone) {
    const s = DB.settings;
    const rates = DB.currentRates();
    const purities = DB.all('purities').filter((p) => p.metalId !== 'NONE');
    const itemNames = DB.all('items').filter((i) => i.metalId === 'GOLD' || i.metalId === 'SILVER' || i.metalId === 'PLATINUM').map((i) => i.name);
    const st = {
      customerId: '', date: U.today(), idProof: 'Aadhaar', idNumber: '', packetNo: '', payoutMode: 'Cash', payoutRef: '', notes: '',
      ltvPct: U.n(s.pawnLtvPct) || 75, interestPct: U.n(s.pawnInterestPct) || 1.5, interestMethod: s.pawnMethod || 'MONTHLY',
      minMonths: U.n(s.pawnMinMonths) || 1, tenureMonths: U.n(s.pawnTenureMonths) || 12, processingFee: 0, principal: '', principalEdited: false,
      items: [{ description: '', purityId: 'G22K', grossWt: '', lessWt: '', rate: rates.G22K || '' }],
    };

    const itemRow = (it, i) => '<tr data-i="' + i + '">' +
      '<td><input list="pw-items" data-k="description" value="' + esc(it.description) + '" placeholder="e.g. Gold chain"></td>' +
      '<td><select data-k="purityId">' + purities.map((p) => '<option value="' + p.id + '"' + (p.id === it.purityId ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></td>' +
      '<td><input type="number" step="0.001" min="0" data-k="grossWt" value="' + esc(it.grossWt) + '"></td>' +
      '<td><input type="number" step="0.001" min="0" data-k="lessWt" value="' + esc(it.lessWt) + '" title="Stones, lac, dirt, hooks"></td>' +
      '<td class="right" data-net></td>' +
      '<td><input type="number" step="any" min="0" data-k="rate" value="' + esc(it.rate) + '"></td>' +
      '<td class="right" data-val></td>' +
      '<td><button type="button" class="icon-btn danger" data-rm="' + i + '">&times;</button></td></tr>';

    const m = UI.modal({
      title: 'New pawn (girvi) loan', size: 'xl',
      body:
        '<datalist id="pw-items">' + itemNames.map((n) => '<option value="' + esc(n) + '">').join('') + '</datalist>' +
        '<datalist id="pw-cust">' + DB.all('customers').filter((c) => c.id !== 'cus_walkin').map((c) => '<option value="' + esc(custLabel(c)) + '">').join('') + '</datalist>' +
        '<div class="form-grid pw-head">' +
        '<div class="field full"><label>Customer (pledger) <b class="req">*</b></label><div class="input-row"><input class="pw-cust" list="pw-cust" placeholder="Search name or mobile..."><button type="button" class="btn" data-newcust>+ New</button></div><small class="pw-cust-info muted"></small></div>' +
        '<div class="field"><label>Pawn date</label><input type="date" data-h="date" value="' + st.date + '" max="' + U.today() + '"></div>' +
        '<div class="field"><label>Packet / locker no.</label><input data-h="packetNo" placeholder="e.g. L1-024"></div>' +
        '<div class="field"><label>ID proof <b class="req">*</b></label><select data-h="idProof">' + ID_PROOFS.map((x) => '<option>' + x + '</option>').join('') + '</select></div>' +
        '<div class="field"><label>ID number <b class="req">*</b></label><input data-h="idNumber" autocomplete="off"><small>Only the last 4 characters are stored</small></div>' +
        '</div>' +
        '<h4 class="sub">Items pledged</h4>' +
        '<div class="table-wrap"><table class="grid edit-grid pw-grid"><thead><tr><th>Item</th><th>Purity (tested)</th><th>Gross g</th><th>Less g</th><th class="right">Net g</th><th>Rate ₹/g</th><th class="right">Value</th><th></th></tr></thead><tbody class="pw-items"></tbody></table></div>' +
        '<div class="actions-row"><button type="button" class="btn sm" data-addrow>+ Add item</button><span class="spacer"></span><span class="pw-itotals muted"></span></div>' +
        '<h4 class="sub">Loan</h4>' +
        '<div class="pw-loan">' +
        '<div class="form-grid">' +
        '<div class="field"><label>Loan to value (LTV) %</label><input type="number" min="1" max="100" step="any" data-h="ltvPct" value="' + st.ltvPct + '"></div>' +
        '<div class="field"><label>Loan amount (₹) <b class="req">*</b></label><input type="number" min="0" step="100" data-h="principal"><small class="pw-elig"></small></div>' +
        '<div class="field"><label>Interest % per month</label><input type="number" min="0" step="any" data-h="interestPct" value="' + st.interestPct + '"><small class="pw-yearly"></small></div>' +
        '<div class="field"><label>Interest method</label><select data-h="interestMethod">' + METHODS.map((x) => '<option value="' + x.value + '"' + (x.value === st.interestMethod ? ' selected' : '') + '>' + x.label + '</option>').join('') + '</select></div>' +
        '<div class="field"><label>Minimum interest (months)</label><input type="number" min="0" step="1" data-h="minMonths" value="' + st.minMonths + '"></div>' +
        '<div class="field"><label>Tenure (months)</label><input type="number" min="1" step="1" data-h="tenureMonths" value="' + st.tenureMonths + '"><small class="pw-due"></small></div>' +
        '<div class="field"><label>Processing fee (₹)</label><input type="number" min="0" step="any" data-h="processingFee" value="0"></div>' +
        '<div class="field"><label>Loan paid out by</label><select data-h="payoutMode">' + payModes().map((x) => '<option>' + esc(x) + '</option>').join('') + '</select></div>' +
        '<div class="field"><label>Payout reference (UTR / cheque)</label><input data-h="payoutRef"></div>' +
        '<div class="field full"><label>Notes</label><input data-h="notes"></div>' +
        '</div><div class="pw-summary totals-box"></div></div>',
      actions: [{ label: 'Cancel' }, { label: 'Save pawn', cls: 'btn primary', onClick: () => { save(); return false; } }],
    });
    const el = m.el;
    const $ = (q) => el.querySelector(q);

    function drawItems() { $('.pw-items').innerHTML = st.items.map(itemRow).join(''); recalc(); }

    function recalc() {
      const t = Pawn.totals(st.items);
      t.items.forEach((it, i) => {
        const tr = el.querySelector('tr[data-i="' + i + '"]');
        if (!tr) return;
        tr.querySelector('[data-net]').textContent = U.num(it.netWt);
        tr.querySelector('[data-val]').textContent = U.inr(it.value, { whole: true });
      });
      const eligible = Pawn.eligible(t.value, st.ltvPct);
      if (!st.principalEdited) { st.principal = eligible || ''; $('[data-h=principal]').value = st.principal; }
      const loan = U.n(st.principal);
      $('.pw-itotals').innerHTML = st.items.length + ' item(s) &middot; Gross <b>' + U.num(t.grossWt) + ' g</b> &middot; Net <b>' + U.num(t.netWt) + ' g</b> &middot; Value <b>' + U.inr(t.value, { whole: true }) + '</b>';
      $('.pw-elig').textContent = 'Maximum at ' + st.ltvPct + '% LTV: ' + U.inr(eligible, { whole: true });
      $('.pw-elig').className = 'pw-elig' + (loan > eligible ? ' warn-text' : '');
      $('.pw-yearly').textContent = '= ' + U.r2(U.n(st.interestPct) * 12) + '% per year';
      const due = Pawn.dueDate(st.date, st.tenureMonths);
      $('.pw-due').textContent = 'Due on ' + U.fmtDate(due);
      const monthly = U.r2(loan * U.n(st.interestPct) / 100);
      const row = (k, v, cls) => '<div class="' + (cls || '') + '"><span>' + k + '</span><b>' + v + '</b></div>';
      $('.pw-summary').innerHTML =
        row('Market value of items', U.inr(t.value, { whole: true })) +
        row('Loan amount', U.inr(loan, { whole: true }), 'grand') +
        row('Actual LTV', t.value ? U.r2(loan / t.value * 100) + '%' : '-', loan > eligible ? 'due' : '') +
        row('Interest per month', U.inr(monthly)) +
        row('Processing fee', U.inr(st.processingFee || 0)) +
        row('Cash / transfer to customer', U.inr(loan - U.n(st.processingFee), { whole: true })) +
        row('Due date', U.fmtDate(due)) +
        row('To redeem on due date', U.inr(Math.round(loan + monthly * U.n(st.tenureMonths)), { whole: true }));
      return { t, eligible, loan, due };
    }

    function fillCustomerInfo() {
      const c = DB.get('customers', st.customerId);
      $('.pw-cust-info').innerHTML = c ? esc([c.phone, c.city, c.pan && 'PAN ' + c.pan].filter(Boolean).join(' · ')) +
        (Pawn.active().filter((p) => p.customerId === c.id).length ? ' · <b class="warn-text">' + Pawn.active().filter((p) => p.customerId === c.id).length + ' active pawn loan(s)</b>' : '') : '';
    }

    el.addEventListener('input', (e) => {
      const t = e.target;
      if (t.classList.contains('pw-cust')) {
        const c = DB.all('customers').find((x) => custLabel(x) === t.value.trim());
        st.customerId = c ? c.id : '';
        fillCustomerInfo();
        return;
      }
      if (t.dataset.h) {
        st[t.dataset.h] = t.value;
        if (t.dataset.h === 'principal') st.principalEdited = t.value !== '';
        recalc();
        return;
      }
      const k = t.dataset.k;
      const tr = t.closest('tr[data-i]');
      if (k && tr) {
        const it = st.items[+tr.dataset.i];
        it[k] = t.value;
        if (k === 'purityId') { it.rate = rates[it.purityId] || ''; tr.querySelector('[data-k=rate]').value = it.rate; }
        recalc();
      }
    });
    el.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm && st.items.length > 1) { st.items.splice(+rm.dataset.rm, 1); drawItems(); }
      if (e.target.closest('[data-addrow]')) {
        const last = st.items[st.items.length - 1];
        st.items.push({ description: '', purityId: last.purityId, grossWt: '', lessWt: '', rate: rates[last.purityId] || '' });
        drawItems();
      }
      if (e.target.closest('[data-newcust]')) quickCustomer();
    });

    function quickCustomer() {
      const fields = Schemas.customers.fields.filter((f) => ['name', 'phone', 'address', 'city', 'pan', 'aadhaarLast4'].includes(f.name));
      UI.modal({
        title: 'New customer', size: 'wide', body: UI.formHtml(fields, {}),
        actions: [{ label: 'Cancel' }, {
          label: 'Save', cls: 'btn primary', onClick: (mel) => {
            const d = UI.readForm(mel, fields);
            if (!d) return false;
            if (!d.phone) { UI.toast('Mobile number is required for pawn customers', 'error'); return false; }
            Object.assign(d, { groupId: 'cg_1', state: DB.settings.state, waOptIn: false });
            const err = Schemas.customers.beforeSave(d, true, null);
            if (err) { UI.toast(err, 'error'); return false; }
            const c = DB.insert('customers', d);
            el.querySelector('#pw-cust').insertAdjacentHTML('beforeend', '<option value="' + esc(custLabel(c)) + '">');
            $('.pw-cust').value = custLabel(c);
            st.customerId = c.id;
            fillCustomerInfo();
          },
        }],
      });
    }

    async function save() {
      const c = DB.get('customers', st.customerId);
      if (!c) { UI.toast('Choose the customer from the list (or add a new one)', 'error'); return; }
      const idNum = String(st.idNumber || '').replace(/\s/g, '');
      if (idNum.length < 4) { UI.toast('Enter the ID proof number', 'error'); return; }
      const r = recalc();
      const items = r.t.items.filter((it) => it.description.trim() || U.n(it.grossWt));
      if (!items.length) { UI.toast('Add at least one item', 'error'); return; }
      const bad = items.find((it) => !it.description.trim() || !(it.netWt > 0) || !(U.n(it.rate) > 0) || U.n(it.lessWt) > U.n(it.grossWt));
      if (bad) { UI.toast('Check item "' + (bad.description || 'unnamed') + '": description, weights and rate are needed', 'error'); return; }
      if (!(r.loan > 0)) { UI.toast('Enter the loan amount', 'error'); return; }
      if (r.loan > r.eligible) { UI.toast('Loan is more than ' + st.ltvPct + '% of the item value (' + U.inr(r.eligible, { whole: true }) + '). Reduce it or change the LTV.', 'error'); return; }
      if (st.payoutMode === 'Cash' && r.loan >= 20000 &&
        !(await UI.confirm('Loans of ₹20,000 or more should not be paid in cash (Income Tax s.269SS). Pay by bank transfer / UPI instead. Continue with cash anyway?', 'Continue with cash'))) return;
      const t = Pawn.totals(items);
      const rec = DB.insert('pawns', {
        pawnNo: DB.nextNo('pawn', s.pawnPrefix || 'PWN', st.date, Branch.workId()), branchId: Branch.workId(),
        customerId: c.id, customerName: c.name, date: st.date, dueDate: r.due,
        idProof: st.idProof, idLast4: idNum.slice(-4).toUpperCase(), packetNo: st.packetNo.trim(),
        items: t.items.map((it) => ({ description: it.description.trim(), purityId: it.purityId, grossWt: U.r3(it.grossWt), lessWt: U.r3(it.lessWt), netWt: it.netWt, rate: U.n(it.rate), value: it.value })),
        grossWt: t.grossWt, netWt: t.netWt, value: t.value,
        ltvPct: U.n(st.ltvPct), principal: r.loan, interestPct: U.n(st.interestPct), interestMethod: st.interestMethod,
        minMonths: U.n(st.minMonths), tenureMonths: U.n(st.tenureMonths), processingFee: U.n(st.processingFee),
        payoutMode: st.payoutMode, payoutRef: st.payoutRef.trim(), notes: st.notes.trim(),
        status: 'ACTIVE', payments: [], by: Auth.user.username,
      });
      m.close();
      UI.toast('Pawn ' + rec.pawnNo + ' saved');
      if (onDone) onDone();
      detail(rec, onDone, true);
    }

    drawItems();
  }

  // ---------------- one pawn ----------------

  function detail(p, refresh, justCreated) {
    const c = DB.get('customers', p.customerId) || { name: p.customerName };
    const now = Pawn.calc(p);
    const rates = DB.currentRates();
    const valueToday = U.sum(p.items, (it) => U.n(it.netWt) * U.n(rates[it.purityId] || it.rate));
    const kpi = (k, v, cls) => '<div class="kpi ' + (cls || '') + '"><span>' + k + '</span><b>' + v + '</b></div>';
    const actions = [{ label: 'Close' }, { label: 'Print ticket', cls: 'btn', onClick: () => { printTicket(p); return false; } },
      { label: 'Packet QR sticker', cls: 'btn', onClick: () => { printPacket(p); return false; } }];
    if (p.status === 'ACTIVE') {
      if (canAdmin() && now.overdueDays > 0) actions.push({ label: 'Mark forfeited', cls: 'btn danger', onClick: () => { forfeit(p, refresh); } });
      actions.push({ label: 'Extend due date', cls: 'btn', onClick: () => { extend(p, refresh); } });
      actions.push({ label: 'Receive payment', cls: 'btn', onClick: () => { receive(p, refresh, false); } });
      actions.push({ label: 'Redeem & release', cls: 'btn primary', onClick: () => { receive(p, refresh, true); } });
    }
    const m = UI.modal({
      title: 'Pawn ' + p.pawnNo + ' - ' + c.name, size: 'xl',
      body:
        (justCreated ? '<div class="banner ok-banner">Saved. Print the pawn ticket for the customer and the QR sticker for the packet.</div>' : '') +
        '<div class="kpis compact">' +
        kpi('Loan given', U.inr(p.principal, { whole: true })) +
        kpi('Principal outstanding', U.inr(now.principal, { whole: true })) +
        kpi('Interest due today', U.inr(now.interestDue, { whole: true }), now.interestDue ? 'warn' : '') +
        kpi(p.status === 'ACTIVE' ? 'To redeem today' : 'Status', p.status === 'ACTIVE' ? U.inr(now.payoff, { whole: true }) : statusBadge(p)) +
        '</div>' +
        '<div class="grid-2"><dl class="info">' +
        [['Status', statusBadge(p, now)], ['Customer', esc(c.name) + (c.phone ? ' &middot; ' + esc(c.phone) : '') + (c.code ? ' <small class="muted">' + esc(c.code) + '</small>' : '')],
          ['ID proof', esc(p.idProof + ' ending ' + p.idLast4)], ['Pawn date', U.fmtDate(p.date)], ['Due date', U.fmtDate(p.dueDate) + (now.overdueDays ? ' <b class="warn-text">(' + now.overdueDays + ' days overdue)</b>' : '')],
          ['Closed on', p.closedOn ? U.fmtDate(p.closedOn) : ''], ['Packet / locker', esc(p.packetNo || '-')]]
          .filter((x) => x[1]).map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('') + '</dl>' +
        '<dl class="info">' +
        [['Interest', U.r2(p.interestPct) + '% per month (' + U.r2(p.interestPct * 12) + '% p.a.), ' + (p.interestMethod === 'DAILY' ? 'daily' : 'monthly') + ', min ' + U.n(p.minMonths) + ' month(s)'],
          ['Interest charged so far', U.inr(now.accrued) + ' for ' + now.chargedMonths + ' month(s)'], ['Interest received', U.inr(now.interestPaid)],
          ['Value at pawn', U.inr(p.value, { whole: true }) + ' (loan ' + (p.value ? U.r2(p.principal / p.value * 100) : 0) + '% of value, limit ' + U.r2(p.ltvPct) + '%)'],
          ['Value at today\'s rate', U.inr(valueToday, { whole: true }) + (valueToday ? ' (LTV now ' + U.r2(now.principal / valueToday * 100) + '%)' : '')],
          ['Paid out', esc(p.payoutMode + (p.payoutRef ? ' (' + p.payoutRef + ')' : '') + (p.processingFee ? ', fee ' + U.inr(p.processingFee) : ''))],
          ['Notes', esc(p.notes || '')], ['Forfeit notes', esc(p.forfeitNotes || '')]]
          .filter((x) => x[1]).map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('') + '</dl></div>' +
        '<h4 class="sub">Items (' + p.items.length + ') &middot; Gross ' + U.num(p.grossWt) + ' g &middot; Net ' + U.num(p.netWt) + ' g</h4>' +
        UI.table({
          columns: [
            { label: '#', render: (it) => p.items.indexOf(it) + 1 }, { label: 'Item', key: 'description' },
            { label: 'Purity', render: (it) => esc(Biz.purityName(it.purityId)) },
            { label: 'Gross g', align: 'right', render: (it) => U.num(it.grossWt) }, { label: 'Less g', align: 'right', render: (it) => U.num(it.lessWt) },
            { label: 'Net g', align: 'right', render: (it) => U.num(it.netWt) }, { label: 'Rate', align: 'right', render: (it) => U.inr(it.rate, { whole: true }) },
            { label: 'Value', align: 'right', render: (it) => U.inr(it.value, { whole: true }) },
          ],
          rows: p.items,
        }) +
        '<h4 class="sub">Payments</h4>' +
        UI.table({
          columns: [
            { label: 'Date', render: (x) => U.fmtDate(x.date) }, { label: 'Amount', align: 'right', render: (x) => U.inr(x.amount) },
            { label: 'Interest', align: 'right', render: (x) => U.inr(x.interestPart) }, { label: 'Principal', align: 'right', render: (x) => U.inr(x.principalPart) },
            { label: 'Mode', key: 'mode' }, { label: 'Ref', key: 'ref' }, { label: 'Type', key: 'type' }, { label: 'By', key: 'by' },
          ],
          rows: p.payments || [], empty: 'No payments yet',
        }),
      actions,
    });
    return m;
  }

  function receive(p, refresh, redeem) {
    const fields = [
      { name: 'date', label: 'Date', type: 'date', required: true, default: U.today() },
      { name: 'amount', label: 'Amount received (₹)', type: 'number', min: 1, required: true, readonly: redeem },
      { name: 'mode', label: 'Mode', type: 'select', required: true, options: payModes() },
      { name: 'ref', label: 'Reference / UTR' },
    ];
    const c0 = Pawn.calc(p, U.today());
    const m = UI.modal({
      title: (redeem ? 'Redeem & release - ' : 'Receive payment - ') + p.pawnNo,
      body: UI.formHtml(fields, { amount: redeem ? c0.payoff : c0.interestDue || '' }) + '<div class="pw-split totals-box"></div>' +
        (redeem ? '<label class="check pw-confirm"><input type="checkbox" name="handed"> All ' + p.items.length + ' item(s) checked and handed back to the customer</label>' : '<p class="muted small">The payment goes to interest due first; anything extra reduces the principal.</p>'),
      actions: [{ label: 'Cancel' }, {
        label: redeem ? 'Redeem' : 'Save payment', cls: 'btn primary', onClick: (el) => {
          const d = UI.readForm(el, fields);
          if (!d) return false;
          if (d.date > U.today()) { UI.toast('Date cannot be in the future', 'error'); return false; }
          if (redeem) {
            if (!el.querySelector('[name=handed]').checked) { UI.toast('Confirm the items were handed back', 'error'); return false; }
            d.amount = Pawn.calc(p, d.date).payoff;
          }
          if (d.mode === 'Cash' && d.amount >= 200000) { UI.toast('Cash receipt of ₹2 lakh or more is not allowed (Sec 269ST). Use another mode.', 'error'); return false; }
          const err = Pawn.applyPayment(p, Object.assign(d, { type: redeem ? 'Redeem' : 'Payment', by: Auth.user.username }));
          if (err) { UI.toast(err, 'error'); return false; }
          DB.update('pawns', p.id, { payments: p.payments, status: p.status, closedOn: p.closedOn || '' });
          UI.toast(p.status === 'REDEEMED' ? p.pawnNo + ' redeemed: items released' : 'Payment of ' + U.inr(d.amount) + ' recorded');
          if (refresh) refresh();
          detail(p, refresh);
        },
      }],
    });
    const split = () => {
      const date = m.el.querySelector('[name=date]').value || U.today();
      const c = Pawn.calc(p, date < p.date ? p.date : date);
      if (redeem) m.el.querySelector('[name=amount]').value = c.payoff;
      const amt = U.n(m.el.querySelector('[name=amount]').value);
      const ip = Math.min(amt, c.interestDue);
      const row = (k, v, cls) => '<div class="' + (cls || '') + '"><span>' + k + '</span><b>' + v + '</b></div>';
      m.el.querySelector('.pw-split').innerHTML = row('Interest due on ' + U.fmtDate(date), U.inr(c.interestDue)) + row('Principal outstanding', U.inr(c.principal)) +
        row('Full redemption amount', U.inr(c.payoff), 'grand') + (redeem ? '' : row('This payment: interest / principal', U.inr(ip) + ' / ' + U.inr(Math.max(0, amt - ip))));
    };
    m.el.addEventListener('input', split);
    split();
  }

  function extend(p, refresh) {
    const fields = [{ name: 'dueDate', label: 'New due date', type: 'date', required: true, default: Pawn.dueDate(p.dueDate, 3) }, { name: 'note', label: 'Reason', full: true }];
    UI.modal({
      title: 'Extend due date - ' + p.pawnNo, body: '<p class="muted">Current due date: ' + U.fmtDate(p.dueDate) + '. Interest keeps running until the loan is redeemed.</p>' + UI.formHtml(fields, {}),
      actions: [{ label: 'Cancel' }, {
        label: 'Extend', cls: 'btn primary', onClick: (el) => {
          const d = UI.readForm(el, fields);
          if (!d) return false;
          if (d.dueDate <= p.dueDate) { UI.toast('New date must be after ' + U.fmtDate(p.dueDate), 'error'); return false; }
          const hist = (p.extensions || []).concat([{ from: p.dueDate, to: d.dueDate, note: d.note, at: U.today(), by: Auth.user.username }]);
          DB.update('pawns', p.id, { dueDate: d.dueDate, extensions: hist });
          UI.toast('Due date extended to ' + U.fmtDate(d.dueDate));
          if (refresh) refresh();
          detail(p, refresh);
        },
      }],
    });
  }

  function forfeit(p, refresh) {
    const fields = [{ name: 'notes', label: 'Notice and auction details', type: 'textarea', rows: 4, required: true, full: true, placeholder: 'Notice sent on ... by registered post; auction held on ... ; amount realised ...' }];
    UI.modal({
      title: 'Mark forfeited - ' + p.pawnNo,
      body: '<div class="banner warn">Pawnbroker laws require written notice to the customer and a waiting period before pledged items can be auctioned or sold. Confirm the legal process was followed before marking this loan forfeited.</div>' + UI.formHtml(fields, {}),
      actions: [{ label: 'Cancel' }, {
        label: 'Mark forfeited', cls: 'btn danger', onClick: (el) => {
          const d = UI.readForm(el, fields);
          if (!d) return false;
          DB.update('pawns', p.id, { status: 'FORFEITED', closedOn: U.today(), forfeitNotes: d.notes, forfeitedBy: Auth.user.username });
          UI.toast(p.pawnNo + ' marked forfeited');
          if (refresh) refresh();
        },
      }],
    });
  }

  // ---------------- printing ----------------

  function printPacket(p) {
    const c = DB.get('customers', p.customerId) || { name: p.customerName };
    QR.printLabels([{
      qr: Pawn.qrText(p), title: p.pawnNo,
      // Short lines so they also fit the small A4 sheet labels
      lines: [c.name, 'Net ' + U.num(p.netWt) + ' g', 'Gross ' + U.num(p.grossWt) + ' g', p.items.length + ' item' + (p.items.length > 1 ? 's' : ''), 'Dt ' + U.fmtDate(p.date), p.packetNo ? 'Pkt ' + p.packetNo : ''],
    }], 'Packet QR sticker - ' + p.pawnNo);
  }

  function ticketHtml(p, copy) {
    const s = DB.settings;
    const c = DB.get('customers', p.customerId) || { name: p.customerName };
    const now = Pawn.calc(p);
    return '<div class="invoice pawn-ticket">' +
      '<header class="inv-head">' + (s.logo ? '<img src="' + esc(s.logo) + '" alt="" class="inv-logo">' : '') +
      '<div class="inv-shop"><h2>' + esc(s.shopName) + '</h2><p>' + (Branch.name(p.branchId) ? '<b>' + esc(Branch.name(p.branchId)) + '</b><br>' : '') + esc(Branch.details(p.branchId).address) + '<br>' + esc([Branch.details(p.branchId).phone, s.email].filter(Boolean).join(' | ')) + '</p>' +
      (s.pawnLicence ? '<p><b>Pawnbroker licence:</b> ' + esc(s.pawnLicence) + '</p>' : '') + '</div>' +
      '<div class="inv-title"><h3>PAWN TICKET</h3><p><b>' + esc(p.pawnNo) + '</b><br>Date: ' + U.fmtDate(p.date) + '<br><small>' + esc(copy) + '</small></p></div></header>' +
      '<section class="inv-parties"><div><h4>Pledger</h4><p><b>' + esc(c.name) + '</b>' + (c.code ? ' (' + esc(c.code) + ')' : '') + '<br>' + esc([c.address, c.city].filter(Boolean).join(', ')) +
      (c.phone ? '<br>Mobile: ' + esc(c.phone) : '') + '<br>ID: ' + esc(p.idProof + ' ending ' + p.idLast4) + '</p></div>' +
      '<div class="ticket-qr">' + QR.svg(Pawn.qrText(p), 'L') + '</div></section>' +
      '<table class="inv-table"><thead><tr><th>#</th><th>Item</th><th>Purity</th><th class="right">Gross g</th><th class="right">Less g</th><th class="right">Net g</th><th class="right">Rate</th><th class="right">Value ₹</th></tr></thead><tbody>' +
      p.items.map((it, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(it.description) + '</td><td>' + esc(Biz.purityName(it.purityId)) + '</td><td class="right">' + U.num(it.grossWt) + '</td><td class="right">' + U.num(it.lessWt) +
        '</td><td class="right">' + U.num(it.netWt) + '</td><td class="right">' + U.num(it.rate, 2) + '</td><td class="right">' + U.num(it.value, 2) + '</td></tr>').join('') +
      '<tr><td></td><td><b>Total</b></td><td></td><td class="right"><b>' + U.num(p.grossWt) + '</b></td><td></td><td class="right"><b>' + U.num(p.netWt) + '</b></td><td></td><td class="right"><b>' + U.num(p.value, 2) + '</b></td></tr></tbody></table>' +
      '<div class="inv-bottom"><div class="inv-words"><p><b>Loan amount:</b> ' + U.inr(p.principal) + ' (' + esc(U.amountInWords(p.principal)) + ')</p>' +
      '<p><b>Interest:</b> ' + U.r2(p.interestPct) + '% per month (' + U.r2(p.interestPct * 12) + '% per year), ' + (p.interestMethod === 'DAILY' ? 'charged on actual days' : 'part of a month charged as a full month') + '; minimum ' + U.n(p.minMonths) + ' month(s).</p>' +
      '<p><b>Due date:</b> ' + U.fmtDate(p.dueDate) + '. Paid out by ' + esc(p.payoutMode) + (p.processingFee ? '; processing fee ' + U.inr(p.processingFee) : '') + '.</p>' +
      (p.packetNo ? '<p><b>Packet / locker:</b> ' + esc(p.packetNo) + '</p>' : '') + '</div>' +
      '<table class="inv-totals">' +
      '<tr><td>Loan given</td><td class="right">' + U.inr(p.principal) + '</td></tr>' +
      ((p.payments || []).length ? '<tr><td>Principal repaid</td><td class="right">' + U.inr(now.principalPaid) + '</td></tr><tr><td>Interest received</td><td class="right">' + U.inr(now.interestPaid) + '</td></tr>' : '') +
      (p.status === 'ACTIVE' ? '<tr><td>Interest due as of ' + U.fmtDate(now.asOf) + '</td><td class="right">' + U.inr(now.interestDue) + '</td></tr><tr class="grand"><td>To redeem as of ' + U.fmtDate(now.asOf) + '</td><td class="right">' + U.inr(now.payoff) + '</td></tr>'
        : '<tr class="grand"><td>' + (p.status === 'REDEEMED' ? 'Redeemed on ' : 'Forfeited on ') + U.fmtDate(p.closedOn) + '</td><td class="right">-</td></tr>') +
      '</table></div>' +
      '<footer class="inv-foot"><div class="terms"><b>Terms &amp; conditions</b><br>' + esc(s.pawnTerms || '').replace(/\n/g, '<br>') + '</div>' +
      '<div class="sign"><span>Signature of pledger</span><span>For ' + esc(s.shopName) + '<br><br>Authorised signatory</span></div></footer></div>';
  }

  function printTicket(p) {
    UI.print('<style>@page { size: A4; margin: 10mm; }</style>' + ticketHtml(p, 'Customer copy') + '<div class="page-break"></div>' + ticketHtml(p, 'Office copy'));
  }

  // ---------------- settings ----------------

  function settingsDialog(refresh) {
    const fields = [
      { name: 'pawnLtvPct', label: 'Default loan to value (LTV) %', type: 'number', min: 1, max: 100, required: true },
      { name: 'pawnInterestPct', label: 'Default interest % per month', type: 'number', min: 0, required: true, help: 'Check the maximum rate allowed under your state\'s money-lending / pawnbroker rules' },
      { name: 'pawnMethod', label: 'Interest method', type: 'select', required: true, options: METHODS },
      { name: 'pawnMinMonths', label: 'Minimum interest (months)', type: 'number', min: 0, required: true },
      { name: 'pawnTenureMonths', label: 'Default tenure (months)', type: 'number', min: 1, required: true },
      { name: 'pawnPrefix', label: 'Pawn number prefix', required: true },
      { name: 'pawnLicence', label: 'Pawnbroker / money-lender licence no.', full: true },
      { name: 'pawnTerms', label: 'Pawn ticket terms & conditions', type: 'textarea', rows: 5, full: true },
    ];
    UI.modal({
      title: 'Pawn settings', size: 'wide', body: UI.formHtml(fields, DB.settings),
      actions: [{ label: 'Cancel' }, {
        label: 'Save', cls: 'btn primary', onClick: (el) => {
          const d = UI.readForm(el, fields);
          if (!d) return false;
          if (d.pawnLtvPct > 100) { UI.toast('LTV cannot be more than 100%', 'error'); return false; }
          DB.saveSettings(d);
          UI.toast('Pawn settings saved');
          if (refresh) refresh();
        },
      }],
    });
  }

  // ---------------- screen ----------------

  Pages.register({
    id: 'pawn', title: 'Pawn / Girvi Loans', icon: '&#9878;', roles: ['Admin', 'Manager'],
    render(el, params) {
      const st = { status: 'ACTIVE', q: '' };
      el.innerHTML =
        '<div class="kpis pw-kpis"></div>' +
        '<section class="card"><div class="toolbar wrap">' +
        '<select data-f="status"><option value="ACTIVE">Active</option><option value="OVERDUE">Overdue</option><option value="REDEEMED">Redeemed</option><option value="FORFEITED">Forfeited</option><option value="">All</option></select>' +
        '<input type="search" data-f="q" placeholder="Pawn no, customer, mobile, item... (or scan packet QR)">' +
        '<span class="spacer"></span><button class="btn" data-scan>&#9638; Scan packet QR</button>' +
        (canAdmin() ? '<button class="btn" data-settings>Pawn settings</button>' : '') +
        '<button class="btn primary" data-new>+ New pawn</button></div><div class="pw-body"></div></section>';

      function list() {
        const q = st.q.toLowerCase();
        return DB.all('pawns').map((p) => ({ p, c: Pawn.calc(p) })).filter(({ p, c }) => {
          if (st.status === 'OVERDUE') { if (!(p.status === 'ACTIVE' && c.overdueDays > 0)) return false; }
          else if (st.status && p.status !== st.status) return false;
          if (!q) return true;
          const cu = DB.get('customers', p.customerId) || {};
          return [p.pawnNo, p.customerName, cu.name, cu.phone, p.packetNo].concat(p.items.map((i) => i.description)).some((v) => String(v || '').toLowerCase().includes(q));
        }).sort((a, b) => (a.p.date < b.p.date ? 1 : a.p.date > b.p.date ? -1 : (a.p.pawnNo < b.p.pawnNo ? 1 : -1)));
      }

      function draw() {
        const s = Pawn.summary();
        const month = U.today().slice(0, 7);
        const collected = U.sum(DB.all('pawns').flatMap((p) => (p.payments || []).filter((x) => x.date.slice(0, 7) === month)), 'interestPart');
        el.querySelector('.pw-kpis').innerHTML =
          '<div class="kpi"><span>Active pawn loans</span><b>' + s.count + '</b><small>' + U.wt(s.netWt) + ' held</small></div>' +
          '<div class="kpi"><span>Principal outstanding</span><b>' + U.inr(s.principal, { whole: true }) + '</b></div>' +
          '<div class="kpi"><span>Interest due today</span><b>' + U.inr(s.interestDue, { whole: true }) + '</b><small>across active loans</small></div>' +
          '<div class="kpi"><span>Interest received this month</span><b>' + U.inr(collected, { whole: true }) + '</b></div>' +
          '<div class="kpi ' + (s.overdue ? 'warn' : '') + '"><span>Overdue loans</span><b>' + s.overdue + '</b><small>past due date</small></div>';
        el.querySelector('.pw-body').innerHTML = UI.table({
          columns: [
            { label: 'Pawn no', render: ({ p }) => '<b>' + esc(p.pawnNo) + '</b>' + (p.packetNo ? '<br><small class="muted">Packet ' + esc(p.packetNo) + '</small>' : '') },
            { label: 'Date', render: ({ p }) => U.fmtDate(p.date) },
            { label: 'Customer', render: ({ p }) => esc(DB.name('customers', p.customerId) || p.customerName) + (Branch.viewId() === 'ALL' ? '<br><small class="muted">' + esc(Branch.name(p.branchId)) + '</small>' : '') },
            { label: 'Items', render: ({ p }) => esc(p.items.map((i) => i.description).join(', ')) + '<br><small class="muted">Net ' + U.num(p.netWt) + ' g</small>' },
            { label: 'Loan', align: 'right', render: ({ p }) => U.inr(p.principal, { whole: true }) },
            { label: 'Outstanding', align: 'right', render: ({ c }) => U.inr(c.principal, { whole: true }) },
            { label: 'Interest due', align: 'right', render: ({ p, c }) => (p.status === 'ACTIVE' ? U.inr(c.interestDue, { whole: true }) : '-') },
            { label: 'Due date', render: ({ p }) => U.fmtDate(p.dueDate) },
            { label: 'Status', render: ({ p, c }) => statusBadge(p, c) },
          ],
          rows: list(), empty: st.status === 'ACTIVE' ? 'No active pawn loans. Use "+ New pawn" to record one.' : 'No pawn loans match',
          rowAttr: ({ p }) => 'class="clickable" data-open="' + p.id + '"',
        });
      }

      const openByCode = (code) => {
        const no = Pawn.parseCode(code).toLowerCase();
        return DB.find('pawns', (p) => p.pawnNo.toLowerCase() === no);
      };
      el.querySelectorAll('[data-f]').forEach((i) => i.addEventListener('input', U.debounce(() => {
        st[i.dataset.f] = i.dataset.f === 'q' ? Pawn.parseCode(i.value) : i.value;
        draw();
      }, 150)));
      el.querySelector('[data-f=q]').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const p = openByCode(e.target.value);
        if (p) { e.target.value = ''; st.q = ''; draw(); detail(p, draw); }
      });
      el.querySelector('[data-new]').addEventListener('click', () => newPawn(draw));
      const sb = el.querySelector('[data-settings]');
      if (sb) sb.addEventListener('click', () => settingsDialog(draw));
      el.querySelector('[data-scan]').addEventListener('click', () => {
        const sc = QR.scanner((code) => {
          const p = openByCode(code);
          if (!p) return { ok: false, message: 'is not a pawn packet in this shop' };
          setTimeout(() => { sc.close(); detail(p, draw); }, 300);
          return { ok: true, message: 'opened ' + p.pawnNo };
        });
      });
      el.querySelector('.pw-body').addEventListener('click', (e) => {
        const r = e.target.closest('[data-open]');
        if (r) detail(DB.get('pawns', r.dataset.open), draw);
      });
      draw();
      if (params.new) newPawn(draw);
      if (params.open) { const p = DB.get('pawns', params.open); if (p) detail(p, draw); }
    },
  });

  global.PawnUI = { detail, newPawn };
})(window);
