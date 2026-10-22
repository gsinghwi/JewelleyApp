/* JewelleryApp - pawn broking (girvi): valuation, loan limit, interest and repayments
 *
 * Interest is simple interest at a monthly rate on the principal outstanding:
 *   accrued = sum of (principal x rate% x days / 30) over the periods between payments
 * Method DAILY charges the exact days; MONTHLY charges every started month as a full month.
 * Either way at least `minMonths` of interest is charged on the loan.
 * Each payment goes to interest due first, then to principal.
 */
(function (global) {
  'use strict';

  const DAY = 86400000;
  const days = (from, to) => Math.max(0, Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / DAY));

  const Pawn = {
    days,

    // Value of one pledged item at a rate per gram of its purity
    itemValue(it) {
      const net = U.r3(U.n(it.grossWt) - U.n(it.lessWt));
      return { netWt: net, value: U.r2(net * U.n(it.rate)) };
    },

    totals(items) {
      const list = items.map((it) => Object.assign({}, it, Pawn.itemValue(it)));
      return {
        items: list,
        grossWt: U.r3(U.sum(list, 'grossWt')),
        netWt: U.r3(U.sum(list, 'netWt')),
        value: U.r2(U.sum(list, 'value')),
      };
    },

    eligible(value, ltvPct) {
      // Rounded down to the nearest 100 rupees
      return Math.floor((U.n(value) * U.n(ltvPct) / 100) / 100) * 100;
    },

    dueDate(date, months) {
      const d = new Date(date + 'T00:00:00');
      const target = new Date(d.getFullYear(), d.getMonth() + (Math.round(U.n(months)) || 12), 1);
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      target.setDate(Math.min(d.getDate(), lastDay)); // 31 Jan + 1 month = 28/29 Feb
      return U.isoDate(target);
    },

    /* Loan position on a date (defaults to today, or the closing date for closed loans) */
    calc(p, asOf) {
      asOf = asOf || (p.status !== 'ACTIVE' && p.closedOn ? p.closedOn : U.today());
      if (asOf < p.date) asOf = p.date;
      const rate = U.n(p.interestPct) / 100;
      let principal = U.n(p.principal);
      let accrued = 0, interestPaid = 0, principalPaid = 0, last = p.date;
      (p.payments || []).filter((x) => x.date <= asOf).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach((pay) => {
        accrued += principal * rate * days(last, pay.date) / 30;
        last = pay.date;
        interestPaid += U.n(pay.interestPart);
        principalPaid += U.n(pay.principalPart);
        principal -= U.n(pay.principalPart);
      });
      accrued += principal * rate * days(last, asOf) / 30;
      const elapsed = days(p.date, asOf);
      const minDays = Math.max(0, Math.round(U.n(p.minMonths))) * 30;
      const charged = p.interestMethod === 'MONTHLY' ? Math.max(Math.ceil(elapsed / 30) * 30, minDays) : Math.max(elapsed, minDays);
      accrued += principal * rate * (charged - elapsed) / 30; // rounding up / minimum period, on today's principal
      const interestDue = Math.max(0, Math.round(accrued - interestPaid));
      principal = U.r2(Math.max(0, principal));
      return {
        asOf, principal, principalPaid: U.r2(principalPaid),
        accrued: U.r2(accrued), interestPaid: U.r2(interestPaid), interestDue,
        payoff: Math.round(principal + interestDue),
        elapsedDays: elapsed, chargedMonths: U.r2(charged / 30),
        overdueDays: p.status === 'ACTIVE' ? days(p.dueDate, asOf) : 0,
      };
    },

    /* Record a payment: interest due first, then principal. Returns an error message or null. */
    applyPayment(p, pay) {
      const amount = U.r2(pay.amount);
      if (!(amount > 0)) return 'Enter the amount received';
      if (pay.date < p.date) return 'Payment date cannot be before the pawn date';
      const lastPay = (p.payments || []).map((x) => x.date).sort().pop();
      if (lastPay && pay.date < lastPay) return 'Payment date cannot be before the last payment (' + U.fmtDate(lastPay) + ')';
      const c = Pawn.calc(p, pay.date);
      if (amount > c.payoff) return 'Amount is more than the full redemption amount of ' + U.inr(c.payoff);
      const interestPart = Math.min(amount, c.interestDue);
      const principalPart = U.r2(amount - interestPart);
      (p.payments = p.payments || []).push(Object.assign({}, pay, { amount, interestPart, principalPart }));
      if (principalPart >= c.principal - 0.005 && interestPart >= c.interestDue) {
        p.status = 'REDEEMED';
        p.closedOn = pay.date;
      }
      return null;
    },

    // Text stored in the packet's QR code: single line so USB scanner guns can read it too
    qrText(p) {
      const c = DB.get('customers', p.customerId) || {};
      const items = p.items.map((it) => it.description + ' ' + Biz.purityName(it.purityId).split(' ')[0] + ' ' + U.num(it.netWt) + 'g');
      const shown = items.slice(0, 6).join('; ') + (items.length > 6 ? '; +' + (items.length - 6) + ' more' : '');
      return 'PAWN ' + p.pawnNo + ' | ' + (c.name || '') + (c.code ? ' (' + c.code + ')' : '') + ' | ' + U.fmtDate(p.date) +
        ' | ' + shown + ' | Gross ' + U.num(p.grossWt) + 'g Net ' + U.num(p.netWt) + 'g';
    },

    // Pawn number from a scanned packet QR (or a typed pawn number)
    parseCode(text) {
      const t = String(text || '').trim();
      const m = /^PAWN\s+([^|]+?)\s*(\||$)/i.exec(t);
      return (m ? m[1] : t).trim();
    },

    active() {
      return DB.all('pawns').filter((p) => p.status === 'ACTIVE');
    },

    summary() {
      const act = Pawn.active();
      const calcs = act.map((p) => Pawn.calc(p));
      return {
        count: act.length,
        principal: U.sum(calcs, 'principal'),
        interestDue: U.sum(calcs, 'interestDue'),
        netWt: U.sum(act, 'netWt'),
        overdue: calcs.filter((c) => c.overdueDays > 0).length,
      };
    },
  };

  global.Pawn = Pawn;
})(window);
