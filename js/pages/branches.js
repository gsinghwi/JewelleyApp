/* Branches & access (master branch): create branches, give users access to one branch, see each branch at a glance */
(function () {
  'use strict';
  const esc = U.esc;

  function stats(b) {
    const today = U.today();
    const month = today.slice(0, 7);
    const rates = DB.currentRates();
    const invs = DB.raw('invoices').filter((i) => i.branchId === b.id && i.status !== 'CANCELLED');
    const stock = DB.raw('stock').filter((s) => s.branchId === b.id && s.status === 'IN_STOCK');
    const pawns = DB.raw('pawns').filter((p) => p.branchId === b.id && p.status === 'ACTIVE');
    return {
      today: U.sum(invs.filter((i) => i.date === today), 'grandTotal'),
      month: U.sum(invs.filter((i) => i.date.slice(0, 7) === month), 'grandTotal'),
      bills: invs.filter((i) => i.date.slice(0, 7) === month).length,
      pcs: stock.length, net: U.sum(stock, 'netWt'), value: U.sum(stock, (s) => Biz.pieceValue(s, rates)),
      pawn: U.sum(pawns.map((p) => Pawn.calc(p)), 'principal'), pawnCount: pawns.length,
      customers: DB.raw('customers').filter((c) => c.branchId === b.id).length,
      users: DB.raw('users').filter((u) => u.branchId === b.id && u.active).map((u) => u.username),
    };
  }

  Pages.register({
    id: 'branches', title: 'Branches & Access', icon: '&#9783;', roles: ['Admin', 'Manager'], masterOnly: true,
    render(el) {
      let userFilter = '';
      el.innerHTML =
        '<div class="branch-cards"></div>' +
        '<section class="card"><div class="card-head"><h3>Branches</h3><small class="muted">Each branch sees only its own stock, sales, customers, pawn loans and payments. The master branch sees all of them.</small></div><div class="br-crud"></div></section>' +
        '<section class="card"><div class="card-head"><h3>Users &amp; branch access</h3>' +
        '<select class="user-branch-filter"><option value="">All branches</option>' + Branch.all().map((b) => '<option value="' + b.id + '">' + esc(b.name) + '</option>').join('') + '</select></div>' +
        '<p class="muted small">Every user belongs to one branch. Users of the master branch can switch between all branches in the top bar; branch users see only their branch. Admin users must belong to the master branch.</p>' +
        '<div class="usr-crud"></div></section>';

      const drawCards = () => {
        el.querySelector('.branch-cards').innerHTML = Branch.all().map((b) => {
          const s = stats(b);
          return '<div class="card branch-card' + (b.active === false ? ' inactive' : '') + '">' +
            '<div class="card-head"><h3>' + esc(b.name) + ' ' + (b.type === 'MASTER' ? UI.badge('Master', 'gold') : UI.badge(b.code)) + (b.active === false ? ' ' + UI.badge('Inactive') : '') + '</h3>' +
            '<button class="btn sm" data-open="' + b.id + '">Open branch</button></div>' +
            '<p class="muted small">' + esc([b.address, b.phone].filter(Boolean).join(' · ')) + '</p>' +
            '<div class="mini-kpis">' +
            '<div><span>Today</span><b>' + U.inr(s.today, { whole: true }) + '</b></div>' +
            '<div><span>This month</span><b>' + U.inr(s.month, { whole: true }) + '</b><small>' + s.bills + ' bills</small></div>' +
            '<div><span>Stock</span><b>' + s.pcs + ' pcs</b><small>' + U.wt(s.net) + ' · ' + U.inr(s.value, { whole: true }) + '</small></div>' +
            '<div><span>Pawn loans</span><b>' + U.inr(s.pawn, { whole: true }) + '</b><small>' + s.pawnCount + ' active</small></div>' +
            '</div><p class="small"><b>' + s.customers + '</b> customers &middot; Users: ' + (s.users.length ? esc(s.users.join(', ')) : '<span class="muted">none yet</span>') + '</p></div>';
        }).join('');
      };

      UI.crud(el.querySelector('.br-crud'), Object.assign({}, Schemas.branches, {
        afterSave: () => { drawCards(); usrCrud.render(); },
      }));
      const usrCrud = UI.crud(el.querySelector('.usr-crud'), Object.assign({}, Schemas.users, {
        filter: (u) => !userFilter || u.branchId === userFilter,
        sort: (a, b) => (Branch.name(a.branchId) + a.username < Branch.name(b.branchId) + b.username ? -1 : 1),
        afterSave: drawCards,
      }));

      el.querySelector('.user-branch-filter').addEventListener('change', (e) => { userFilter = e.target.value; usrCrud.render(); });
      el.querySelector('.branch-cards').addEventListener('click', (e) => {
        const b = e.target.closest('[data-open]');
        if (!b) return;
        Branch.setView(b.dataset.open);
        location.hash = '#/dashboard';
        App.refreshShell();
      });
      drawCards();
    },
  });
})();
