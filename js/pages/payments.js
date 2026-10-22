/* Payments: every online payment attempt made through the gateway, with its details */
(function () {
  'use strict';
  const esc = U.esc;

  function details(p, refresh) {
    const inv = p.invoiceId ? DB.get('invoices', p.invoiceId) : null;
    const rows = [
      ['Status', PG.statusBadge(p.status) + (p.refundPending ? ' ' + UI.badge('Refund due (bill cancelled)', 'warn') : '')],
      ['Amount', '<b>' + U.inr(p.amount) + '</b> ' + esc(p.currency || 'INR')],
      ['Date & time', esc(U.fmtDateTime(p.createdAt))],
      ['Gateway', esc((p.gateway === 'RAZORPAY' ? 'Razorpay' : 'Test gateway (simulated)') + ' - ' + (p.env === 'live' ? 'LIVE' : 'TEST') + ' mode')],
      ['Payment ID', '<code>' + esc(p.paymentId || '-') + '</code>'],
      ['Order ID', '<code>' + esc(p.orderId || '-') + '</code>'],
      ['Method', esc((PG.METHOD_LABEL[p.method] || '-') + (p.methodDetail ? ' (' + p.methodDetail + ')' : ''))],
      ['Purpose', esc(p.purpose + (p.description ? ' - ' + p.description : ''))],
      ['Customer', esc(p.customerName || (p.customerId ? DB.name('customers', p.customerId) : 'Walk-in')) + (p.contact ? ' &middot; ' + esc(p.contact) : '')],
      ['Linked to', inv ? '<a href="#/sales?open=' + inv.id + '">Invoice ' + esc(inv.invoiceNo) + '</a>' + (inv.status === 'CANCELLED' ? ' ' + UI.badge('Cancelled', 'err') : '')
        : p.receiptNo ? 'Receipt ' + esc(p.receiptNo) : p.status === 'failed' ? '-' : UI.badge('Not linked to a bill', 'warn')],
      ['Error', esc(p.error ? p.error + (p.errorCode ? ' (' + p.errorCode + ')' : '') : '')],
      ['Collected by', esc(p.by)],
      ['Notes', esc(p.notes || '')],
    ].filter((r) => r[1]);
    const m = UI.modal({
      title: 'Payment ' + (p.paymentId || ''), size: 'wide',
      body: '<dl class="info">' + rows.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>').join('') + '</dl>' +
        (p.status === 'authorized' ? '<p class="muted small">Authorized payments must be captured in the Razorpay dashboard (or by the server in production), otherwise Razorpay refunds them automatically.</p>' : '') +
        (p.refundPending || (!p.invoiceId && !p.receiptId && p.status !== 'failed') ? '<p class="muted small">To refund, use the gateway dashboard, then mark it refunded here.</p>' : ''),
      // Only money that is no longer backing an active bill or receipt can be marked refunded
      actions: [{ label: 'Close' }].concat(Auth.can(['Admin', 'Manager']) && p.status !== 'failed' && p.status !== 'refunded' && (p.refundPending || (!p.invoiceId && !p.receiptId)) ? [{
        label: 'Mark refunded', cls: 'btn danger', onClick: () => {
          UI.confirm('Mark ' + U.inr(p.amount) + ' as refunded? Do this only after refunding it in the gateway dashboard.', 'Mark refunded').then((yes) => {
            if (!yes) return;
            DB.update('gatewayPayments', p.id, { status: 'refunded', refundPending: false, refundedAt: new Date().toISOString(), refundedBy: Auth.user.username });
            UI.toast('Marked as refunded');
            refresh();
          });
        },
      }] : []),
    });
    m.el.addEventListener('click', (e) => { if (e.target.closest('a[href^="#/"]')) m.close(); });
  }

  Pages.register({
    id: 'payments', title: 'Online Payments', icon: '&#8377;', roles: ['Admin', 'Manager'],
    render(el, params) {
      const st = { from: U.addDays(U.today(), -30), to: U.today(), status: '', q: '' };
      el.innerHTML = '<section class="card">' +
        '<div class="pg-mode-line"><span>Gateway: <b>' + esc(PG.mode() === 'OFF' ? 'Off' : PG.label()) + '</b></span>' +
        (Auth.can(['Admin']) ? '<a href="#/settings">Change in Settings</a>' : '') +
        (PG.mode() === 'RAZORPAY' && !DB.settings.pgKeyId ? ' ' + UI.badge('Key ID missing', 'err') : '') + '</div>' +
        '<div class="toolbar wrap">' +
        '<label class="inline">From <input type="date" data-f="from" value="' + st.from + '"></label>' +
        '<label class="inline">To <input type="date" data-f="to" value="' + st.to + '"></label>' +
        '<select data-f="status"><option value="">All statuses</option><option value="captured">Paid</option><option value="authorized">Authorized</option><option value="failed">Failed</option><option value="refunded">Refunded</option><option value="unlinked">Not linked to a bill</option></select>' +
        '<input type="search" data-f="q" placeholder="Payment ID, customer, invoice...">' +
        '<span class="spacer"></span><button class="btn" data-csv>Export CSV</button></div>' +
        '<div class="stock-summary pg-summary"></div><div class="pg-body"></div></section>';

      const cols = [
        { label: 'Date', key: 'createdAt', render: (p) => U.fmtDateTime(p.createdAt), csv: (p) => U.fmtDateTime(p.createdAt) },
        { label: 'Payment ID', key: 'paymentId', render: (p) => '<code>' + esc(p.paymentId || '-') + '</code>' },
        { label: 'Customer', key: 'customerName', render: (p) => esc(p.customerName || 'Walk-in') },
        { label: 'Method', key: 'method', render: (p) => esc(PG.METHOD_LABEL[p.method] || '-') + (p.methodDetail ? '<br><small class="muted">' + esc(p.methodDetail) + '</small>' : ''), csv: (p) => (PG.METHOD_LABEL[p.method] || '') + (p.methodDetail ? ' (' + p.methodDetail + ')' : '') },
        { label: 'For', key: 'invoiceNo', render: (p) => (p.invoiceNo ? esc(p.invoiceNo) : p.receiptNo ? esc(p.receiptNo) : p.status === 'failed' ? '-' : UI.badge('Not linked', 'warn')), csv: (p) => p.invoiceNo || p.receiptNo || '' },
        { label: 'Amount', key: 'amount', align: 'right', render: (p) => U.inr(p.amount), csv: (p) => p.amount },
        { label: 'Status', key: 'status', render: (p) => PG.statusBadge(p.status) + (p.refundPending ? ' ' + UI.badge('Refund due', 'warn') : '') + (p.error ? '<br><small class="muted">' + esc(p.error) + '</small>' : ''), csv: (p) => p.status + (p.refundPending ? ' (refund due)' : '') },
        { label: 'Mode', key: 'env', render: (p) => (p.env === 'live' ? UI.badge('LIVE', 'gold') : UI.badge('TEST')), csv: (p) => p.env },
        { label: 'Error', key: 'error', csv: (p) => p.error || '' },
      ];
      const shown = cols.filter((c) => c.label !== 'Error');

      const rows = () => {
        const q = st.q.toLowerCase();
        return DB.all('gatewayPayments').filter((p) => {
          if (!U.inRange(U.isoDate(p.createdAt), st.from, st.to)) return false;
          if (st.status === 'unlinked') { if (p.status === 'failed' || p.invoiceId || p.receiptId) return false; }
          else if (st.status && p.status !== st.status) return false;
          return !q || [p.paymentId, p.orderId, p.customerName, p.contact, p.invoiceNo, p.receiptNo, p.methodDetail].some((v) => String(v || '').toLowerCase().includes(q));
        }).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      };
      const draw = () => {
        const list = rows();
        const ok = list.filter((p) => p.status === 'captured' || p.status === 'authorized');
        el.querySelector('.pg-summary').innerHTML =
          '<span>Collected <b>' + U.inr(U.sum(ok, 'amount'), { whole: true }) + '</b> in ' + ok.length + ' payment(s)</span>' +
          '<span>Failed attempts <b>' + list.filter((p) => p.status === 'failed').length + '</b></span>' +
          '<span>Refunded <b>' + U.inr(U.sum(list.filter((p) => p.status === 'refunded'), 'amount'), { whole: true }) + '</b></span>' +
          '<span>Refunds due <b>' + list.filter((p) => p.refundPending).length + '</b></span>' +
          '<span>Not linked <b>' + list.filter((p) => p.status !== 'failed' && p.status !== 'refunded' && !p.invoiceId && !p.receiptId).length + '</b></span>';
        el.querySelector('.pg-body').innerHTML = UI.table({
          columns: shown, rows: list,
          empty: PG.enabled() ? 'No online payments in this period. Use "Collect online" on the billing screen.' : 'Online payments are off. An admin can switch them on in Settings > Payment gateway.',
          rowAttr: (p) => 'class="clickable" data-open="' + p.id + '"',
        });
      };
      el.querySelectorAll('[data-f]').forEach((i) => i.addEventListener('input', U.debounce(() => { st[i.dataset.f] = i.value.trim(); draw(); }, 150)));
      el.querySelector('[data-csv]').addEventListener('click', () => U.download('online-payments-' + U.today() + '.csv', U.toCSV(cols, rows()), 'text/csv'));
      el.querySelector('.pg-body').addEventListener('click', (e) => {
        const r = e.target.closest('[data-open]');
        if (r) details(DB.get('gatewayPayments', r.dataset.open), draw);
      });
      draw();
      if (params.open) { const p = DB.get('gatewayPayments', params.open); if (p) details(p, draw); }
    },
  });
})();
