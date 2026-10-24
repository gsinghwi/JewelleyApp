#!/usr/bin/env node
/* Builds desktop/server/seed/default-data.json: the master data loaded on first start.
 * It reuses the mockup's Indian jewellery master data (js/seed.js in the repo root) and drops
 * all demo records (customers, stock, sales, pawns, demo users and branches).
 *
 *   node desktop/tools/make-seed.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const ctx = { window: {}, console, Math, Date, JSON, Object, Array, String, Number, isFinite, parseFloat, unescape, encodeURIComponent };
ctx.window = ctx;
vm.createContext(ctx);
['js/utils.js', 'js/pricing.js', 'js/seed.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));

const demo = ctx.Seed.build();

const settings = Object.assign({}, ctx.Seed.settings, {
  shopName: 'Nisarg Jewellers',
  tagline: '',
  loginWelcome: 'Sign in to manage sales, stock, customers and pawn loans.',
  address: '', phone: '', email: '', gstin: '', pan: '', bisLicence: '', stateCode: '27',
  pgMode: 'OFF', // switched on by the admin after entering Razorpay keys
  waMode: 'LINK',
  liveAutoMins: 0,
  backupDir: 'C:\\ProgramData\\JewelleryApp\\backups',
  backupTime: '21:00',
  backupKeep: 30,
  currency: 'INR',
});
// keys and tokens are kept in the server's secrets (Settings > Integrations), never in the settings
['showDemoHint', 'waToken', 'waPhoneNumberId', 'waApiVersion', 'pgKeyId'].forEach((k) => delete settings[k]);

const currencies = [
  ['INR', 'Indian Rupee', '\u20B9', 1],
  ['USD', 'US Dollar', '$', 0],
  ['AED', 'UAE Dirham', 'AED', 0],
  ['EUR', 'Euro', '\u20AC', 0],
  ['GBP', 'British Pound', '\u00A3', 0],
  ['SGD', 'Singapore Dollar', 'S$', 0],
].map(([code, name, symbol, rateToInr]) => ({ id: code, code, name, symbol, rateToInr, active: true }));

const out = {
  settings,
  collections: {
    branches: [{ id: 'br_ho', code: 'HO', name: 'Head Office', type: 'MASTER', address: '', phone: '', gstin: '', state: 'Maharashtra', manager: '', active: true }],
    currencies,
    categories: demo.categories,
    metals: demo.metals,
    purities: demo.purities,
    hsn: demo.hsn,
    stoneTypes: demo.stoneTypes,
    paymentModes: demo.paymentModes,
    customerGroups: demo.customerGroups,
    items: demo.items,
    waTemplates: demo.waTemplates,
    customers: demo.customers.filter((c) => c.id === 'cus_walkin').map((c) => Object.assign({}, c, { branchId: '' })),
  },
  staff: [{ id: 'usr_admin', username: 'admin', name: 'Administrator', role: 'Admin', branchId: 'br_ho', password: 'admin123', mustChangePassword: true }],
};

const dest = path.join(__dirname, '..', 'server', 'seed', 'default-data.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 1));
const counts = Object.entries(out.collections).map(([k, v]) => k + ':' + v.length).join(' ');
console.log('wrote', path.relative(root, dest), '|', counts);
