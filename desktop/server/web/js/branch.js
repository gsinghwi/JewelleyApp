/* JewelleryApp - branches
 *
 * One MASTER branch (head office) and any number of sub-branches.
 *  - Users belong to one branch. Users of a sub-branch only ever see their own branch's
 *    stock, sales, customers, receipts, pawn loans and payments.
 *  - Master-branch users can view "All branches" (consolidated) or pick one branch in the top bar.
 *  - Stock is purchased into the master branch and transferred to sub-branches, which sell it.
 *  - Masters (items, rates, settings, vendors) are shared and maintained by the master branch.
 *
 * Every read of a branch-owned collection goes through DB.all(), which filters by Branch.visible().
 * In this browser-only prototype that filter is the access control; a server must enforce it too
 * once data moves to a shared database.
 */
(function (global) {
  'use strict';

  const VIEW_KEY = 'jewelleryapp.branchView';
  const OWNED = ['stock', 'invoices', 'receipts', 'customers', 'pawns', 'gatewayPayments', 'purchases', 'vendorPayments', 'transfers'];

  const Branch = {
    OWNED,

    all() {
      return DB.raw('branches');
    },

    get(id) {
      return DB.raw('branches').find((b) => b.id === id) || null;
    },

    masterId() {
      const m = DB.raw('branches').find((b) => b.type === 'MASTER');
      return m ? m.id : '';
    },

    name(id) {
      const b = Branch.get(id);
      return b ? b.name : '';
    },

    code(id) {
      const b = Branch.get(id);
      return b ? b.code : '';
    },

    userBranchId() {
      return global.Auth && Auth.user ? Auth.user.branchId || Branch.masterId() : '';
    },

    // Signed-in user belongs to the master branch (head office)
    isMaster() {
      return !!(global.Auth && Auth.user) && Branch.userBranchId() === Branch.masterId();
    },

    // Branch whose data is shown: 'ALL' (master users only) or a branch id
    viewId() {
      if (!global.Auth || !Auth.user) return 'ALL';
      if (!Branch.isMaster()) return Branch.userBranchId();
      let v = 'ALL';
      try { v = sessionStorage.getItem(VIEW_KEY) || 'ALL'; } catch (e) { /* default */ }
      return v === 'ALL' || Branch.get(v) ? v : 'ALL';
    },

    setView(id) {
      try { sessionStorage.setItem(VIEW_KEY, id); } catch (e) { /* not kept */ }
    },

    clearView() {
      try { sessionStorage.removeItem(VIEW_KEY); } catch (e) { /* ignore */ }
    },

    // Branch where new sales, receipts and pawn loans are recorded
    workId() {
      // head office Sales staff record their own work at head office only
      if (Branch.isMaster() && global.Auth && !Auth.can(['Admin', 'Manager'])) return Branch.userBranchId();
      const v = Branch.viewId();
      return v === 'ALL' ? Branch.masterId() : v;
    },

    viewLabel() {
      const v = Branch.viewId();
      return v === 'ALL' ? 'All branches' : Branch.name(v);
    },

    visible(col, rec) {
      if (!global.Auth || !Auth.user || OWNED.indexOf(col) < 0) return true;
      const v = Branch.viewId();
      if (v === 'ALL') return true;
      if (col === 'transfers') return rec.fromBranchId === v || rec.toBranchId === v;
      return !rec.branchId || rec.branchId === v; // records without a branch (walk-in customer) are shared
    },

    // Invoice / receipt / pawn numbers carry the branch code so every branch has its own series
    docPrefix(prefix, branchId) {
      const code = Branch.code(branchId || Branch.workId());
      return code ? prefix + '/' + code : prefix;
    },

    // Address / GSTIN printed on documents: the branch's own, falling back to the shop's
    details(branchId) {
      const s = DB.settings;
      const b = Branch.get(branchId) || {};
      return {
        name: b.name || '', type: b.type || '',
        address: b.address || s.address, phone: b.phone || s.phone, gstin: b.gstin || s.gstin,
        state: b.state || s.state, stateCode: (b.gstin || '').slice(0, 2) || s.stateCode,
      };
    },
  };

  global.Branch = Branch;
})(window);
