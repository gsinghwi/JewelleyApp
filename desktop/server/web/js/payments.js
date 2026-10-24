/* JewelleryApp - online payment collection through a payment gateway
 *
 * Gateway modes (Settings > Payment gateway):
 *  - SIMULATED: built-in test gateway. No account or internet needed; behaves like a gateway
 *               checkout with test UPI IDs / cards so the whole flow can be tried safely.
 *  - RAZORPAY:  Razorpay Standard Checkout. The Key ID and Key Secret are kept on the server
 *               (Settings > Integrations); the server creates the order, checks the payment
 *               signature, captures the payment and records it. The secret never reaches the browser.
 *  - OFF:       online payments hidden.
 *
 * Every attempt (success or failure) is stored in the 'gatewayPayments' collection. Paid Razorpay
 * payments are written only by the server; the app records failed attempts and test-gateway payments.
 * Card numbers, CVV and UPI PINs are never stored: only the gateway's payment ID, the method,
 * and for cards the network and last 4 digits.
 */
(function (global) {
  'use strict';
  const esc = U.esc;
  let rzpScript = null;

  const METHOD_LABEL = { upi: 'UPI', card: 'Card', netbanking: 'Net Banking', wallet: 'Wallet', online: 'Razorpay' };

  function randomId(prefix) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 14; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return prefix + s;
  }

  function luhn(num) {
    let sum = 0, alt = false;
    for (let i = num.length - 1; i >= 0; i--) {
      let d = +num.charAt(i);
      if (alt) { d *= 2; if (d > 9) d -= 9; }
      sum += d; alt = !alt;
    }
    return sum % 10 === 0;
  }

  function cardNetwork(num) {
    if (/^4/.test(num)) return 'Visa';
    if (/^(5[1-5]|2[2-7])/.test(num)) return 'Mastercard';
    if (/^(60|65|81|82|508)/.test(num)) return 'RuPay';
    if (/^3[47]/.test(num)) return 'Amex';
    return 'Card';
  }

  const PG = {
    METHOD_LABEL,
    serverConfig: { enabled: false, keyId: '', mode: 'test' },

    // Razorpay keys live on the server: ask it whether they are set
    async loadConfig() {
      try {
        PG.serverConfig = await DB.api('razorpay/config');
      } catch (e) {
        PG.serverConfig = { enabled: false, keyId: '', mode: 'test' };
      }
      return PG.serverConfig;
    },

    mode() {
      const m = DB.settings.pgMode;
      return m === 'RAZORPAY' || m === 'OFF' ? m : 'SIMULATED';
    },

    enabled() {
      const m = PG.mode();
      return m === 'SIMULATED' || (m === 'RAZORPAY' && !!PG.serverConfig.enabled);
    },

    env() {
      return PG.mode() === 'RAZORPAY' && PG.serverConfig.mode === 'live' ? 'live' : 'test';
    },

    label() {
      return (PG.mode() === 'RAZORPAY' ? 'Razorpay' : 'Test gateway (simulated)') + (PG.env() === 'test' ? ' - TEST MODE' : '');
    },

    // Mode name used on bills and receipts, e.g. "Online - UPI"
    modeName(rec) {
      return 'Online - ' + (METHOD_LABEL[rec.method] || 'Gateway');
    },

    save(rec) {
      return DB.insert('gatewayPayments', Object.assign({
        gateway: PG.mode(), env: PG.env(), currency: 'INR', by: Auth.user ? Auth.user.username : '',
      }, rec));
    },

    link(paymentRecId, patch) {
      if (paymentRecId) DB.update('gatewayPayments', paymentRecId, patch);
    },

    /* Collect `amount` (rupees) online. Resolves with the saved record when paid, or null if
     * the customer cancelled or the payment failed (failures are saved and shown). */
    async collect(opts) {
      const amount = U.r2(opts.amount);
      if (PG.mode() === 'RAZORPAY') await PG.loadConfig();
      if (!(amount >= 1)) { UI.toast('Enter an amount of at least ₹1', 'error'); return Promise.resolve(null); }
      if (!PG.enabled()) { UI.toast('Online payments are not set up. Ask the admin to configure them in Settings.', 'error'); return Promise.resolve(null); }
      const base = {
        amount, purpose: opts.purpose || 'Sale', description: opts.description || '',
        customerId: opts.customer ? opts.customer.id : '', customerName: opts.customer ? opts.customer.name : '',
        contact: opts.customer ? opts.customer.phone || '' : '',
      };
      return PG.mode() === 'RAZORPAY' ? PG.razorpay(base) : PG.simulate(base);
    },

    loadRazorpay() {
      if (global.Razorpay) return Promise.resolve();
      if (rzpScript) return rzpScript;
      rzpScript = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.onload = () => resolve();
        s.onerror = () => { rzpScript = null; reject(new Error('Could not load Razorpay. Check the internet connection.')); };
        document.head.appendChild(s);
      });
      return rzpScript;
    },

    async razorpay(base) {
      const st = DB.settings;
      let order;
      try {
        await PG.loadRazorpay();
        order = await DB.api('razorpay/order', { method: 'POST', body: {
          amount: base.amount, // rupees; the server converts to paise
          receipt: (base.purpose || 'Sale').slice(0, 20) + '-' + Date.now(),
          notes: { purpose: base.purpose, customer: base.customerName },
        } });
      } catch (e) {
        UI.toast(DB.errorText(e), 'error');
        return null;
      }
      return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        const rzp = new global.Razorpay({
          key: order.keyId,
          order_id: order.orderId,
          amount: order.amount,
          currency: order.currency || 'INR',
          name: st.shopName || 'JewelleryApp',
          description: base.description || base.purpose,
          image: /^https?:/.test(st.logo || '') ? st.logo : undefined,
          prefill: { name: base.customerName, contact: base.contact },
          notes: { purpose: base.purpose, customer: base.customerName },
          theme: { color: st.primaryColor || '#7a1f2b' },
          handler: async (resp) => {
            let v;
            try {
              // the server checks the payment with Razorpay and records it
              v = await DB.api('razorpay/verify', { method: 'POST', body: {
                orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature,
                branchId: Branch.workId(), purpose: base.purpose, description: base.description,
                customerId: base.customerId, customerName: base.customerName, contact: base.contact,
              } });
            } catch (e) {
              v = { verified: false, error: DB.errorText(e) };
            }
            const ok = v.verified && v.record && (v.status === 'captured' || v.status === 'authorized');
            if (!ok) {
              const err = v.error || 'Payment could not be confirmed (status: ' + (v.status || 'unknown') + ')';
              UI.toast('Payment not confirmed: ' + err + '. Payment ID ' + resp.razorpay_payment_id, 'error');
              finish(null);
              return;
            }
            const rec = DB.ingest('gatewayPayments', v.record);
            UI.toast('Payment received: ' + resp.razorpay_payment_id);
            finish(rec);
          },
          modal: { ondismiss: () => setTimeout(() => finish(null), 300) },
        });
        rzp.on('payment.failed', (resp) => {
          const err = resp.error || {};
          PG.save(Object.assign({}, base, {
            status: 'failed', method: err.metadata && err.metadata.payment_id ? 'online' : '',
            paymentId: err.metadata ? err.metadata.payment_id || '' : '', orderId: err.metadata ? err.metadata.order_id || '' : order.orderId,
            error: [err.description, err.reason].filter(Boolean).join(' - ') || 'Payment failed', errorCode: err.code || '',
          }));
          UI.toast('Payment failed: ' + (err.description || 'unknown error'), 'error');
        });
        rzp.open();
      });
    },

    /* Built-in test checkout */
    simulate(base) {
      return new Promise((resolve) => {
        let result = null, method = 'upi';
        const st = DB.settings;
        const m = UI.modal({
          title: 'Pay ' + U.inr(base.amount),
          body:
            '<div class="pg-sim"><div class="pg-head"><div><b>' + esc(st.shopName) + '</b><small>' + esc(base.description || base.purpose) + '</small></div>' +
            '<div class="pg-amt">' + U.inr(base.amount) + '<span class="pg-test">TEST MODE</span></div></div>' +
            '<nav class="pg-tabs">' + [['upi', 'UPI'], ['card', 'Card'], ['netbanking', 'Net Banking'], ['wallet', 'Wallet']]
              .map(([k, l]) => '<button type="button" data-m="' + k + '"' + (k === method ? ' class="active"' : '') + '>' + l + '</button>').join('') + '</nav>' +
            '<div class="pg-pane" data-pane="upi"><div class="field"><label>UPI ID</label><input name="vpa" value="success@razorpay" autocomplete="off"></div>' +
            '<small class="muted">Test: <b>success@razorpay</b> succeeds, <b>failure@razorpay</b> fails.</small></div>' +
            '<div class="pg-pane" data-pane="card" hidden><div class="field"><label>Card number</label><input name="card" value="4111 1111 1111 1111" inputmode="numeric" autocomplete="off"></div>' +
            '<div class="form-grid"><div class="field"><label>Expiry (MM/YY)</label><input name="exp" value="12/30"></div><div class="field"><label>CVV</label><input name="cvv" value="123" type="password" maxlength="4"></div></div>' +
            '<small class="muted">Test: <b>4111 1111 1111 1111</b> succeeds, <b>4000 0000 0000 0002</b> is declined. The card number is never saved.</small></div>' +
            '<div class="pg-pane" data-pane="netbanking" hidden><div class="field"><label>Bank</label><select name="bank"><option>State Bank of India</option><option>HDFC Bank</option><option>ICICI Bank</option><option>Axis Bank</option><option>Kotak Mahindra Bank</option></select></div></div>' +
            '<div class="pg-pane" data-pane="wallet" hidden><div class="field"><label>Wallet</label><select name="wallet"><option>Paytm</option><option>PhonePe</option><option>Amazon Pay</option><option>Mobikwik</option></select></div></div>' +
            '<label class="check pg-fail" hidden><input type="checkbox" name="fail"> Simulate a failed payment</label>' +
            '<div class="pg-status" hidden></div></div>',
          actions: [{ label: 'Cancel' }, { label: 'Pay ' + U.inr(base.amount), cls: 'btn primary pg-pay', onClick: () => false }],
        });
        const el = m.el;
        const q = (n) => el.querySelector('[name=' + n + ']');
        const showMethod = (k) => {
          method = k;
          el.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('active', b.dataset.m === k));
          el.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== k; });
          el.querySelector('.pg-fail').hidden = !(k === 'netbanking' || k === 'wallet');
          el.querySelector('.pg-status').hidden = true;
        };
        el.querySelector('.pg-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) showMethod(b.dataset.m); });

        const obs = new MutationObserver(() => {
          if (!document.body.contains(el)) { obs.disconnect(); resolve(result); }
        });
        obs.observe(document.body, { childList: true });

        el.querySelector('.pg-pay').addEventListener('click', () => {
          let detail = '', fail = false, err = '';
          if (method === 'upi') {
            const vpa = q('vpa').value.trim().toLowerCase();
            if (!/^[a-z0-9._-]{2,}@[a-z]{2,}$/.test(vpa)) { UI.toast('Enter a valid UPI ID, e.g. success@razorpay', 'error'); return; }
            detail = 'UPI ' + vpa; fail = vpa.startsWith('failure'); err = 'Payment declined by the UPI app';
          } else if (method === 'card') {
            const num = q('card').value.replace(/\D/g, '');
            if (num.length < 12 || !luhn(num)) { UI.toast('Card number is not valid', 'error'); return; }
            const exp = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(q('exp').value.trim());
            if (!exp || new Date(2000 + +exp[2], +exp[1], 0) < new Date()) { UI.toast('Enter a valid future expiry, MM/YY', 'error'); return; }
            if (!/^\d{3,4}$/.test(q('cvv').value)) { UI.toast('Enter the CVV', 'error'); return; }
            detail = cardNetwork(num) + ' card ending ' + num.slice(-4); fail = num === '4000000000000002'; err = 'Card declined by the issuing bank';
          } else if (method === 'netbanking') {
            detail = q('bank').value; fail = q('fail').checked; err = 'Bank authentication failed';
          } else {
            detail = q('wallet').value + ' wallet'; fail = q('fail').checked; err = 'Insufficient wallet balance';
          }
          const status = el.querySelector('.pg-status');
          status.hidden = false;
          status.className = 'pg-status';
          status.textContent = 'Processing payment...';
          el.querySelector('.pg-pay').disabled = true;
          setTimeout(() => {
            const rec = PG.save(Object.assign({}, base, {
              method, methodDetail: detail, status: fail ? 'failed' : 'captured',
              paymentId: randomId('pay_SIM'), orderId: randomId('order_SIM'), error: fail ? err : '',
            }));
            if (fail) {
              status.className = 'pg-status err';
              status.textContent = 'Payment failed: ' + err + '. Try again or use another method.';
              el.querySelector('.pg-pay').disabled = false;
              return;
            }
            status.className = 'pg-status ok';
            status.textContent = 'Payment successful. ID ' + rec.paymentId;
            result = rec;
            setTimeout(() => m.close(), 700);
          }, 900);
        });
      });
    },

    statusBadge(s) {
      return s === 'captured' ? UI.badge('Paid', 'ok') : s === 'authorized' ? UI.badge('Authorized', 'gold') : s === 'refunded' ? UI.badge('Refunded') : UI.badge('Failed', 'err');
    },
  };

  global.PG = PG;
})(window);
