/* JewelleryApp - WhatsApp messaging
 *
 * Two sending modes (Settings on the WhatsApp screen):
 *  - LINK: click-to-chat. Opens WhatsApp (app or web) with the message typed in; staff press Send.
 *          Free, no account needed. Bulk sends go one contact at a time.
 *  - API:  WhatsApp Business Cloud API (Meta). Messages are sent automatically using a
 *          pre-approved template. Needs a Meta business account, phone number ID and access token.
 *
 * Template text uses placeholders: {name} {shop} {shopPhone} {address} {date}.
 * In API mode the placeholders are passed, in order of appearance, as the approved
 * template's {{1}}, {{2}} ... body parameters.
 */
(function (global) {
  'use strict';

  const PLACEHOLDER = /\{(name|shop|shopPhone|address|date)\}/g;

  const WA = {
    // Indian mobile numbers to international format without '+', e.g. 919876543210
    normalizePhone(raw) {
      let d = String(raw || '').replace(/\D/g, '');
      if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
      if (d.length === 10 && /^[6-9]/.test(d)) d = '91' + d;
      if (d.length === 12 && d.startsWith('91') && /^[6-9]/.test(d.charAt(2))) return d;
      if (d.length >= 11 && d.length <= 15 && !d.startsWith('91')) return d; // other country codes
      return '';
    },

    vars(party, extra) {
      const s = DB.settings;
      return Object.assign({
        name: party.contactPerson || party.name || 'Customer',
        shop: s.shopName || '',
        shopPhone: s.phone || '',
        address: s.address || '',
        date: '',
      }, extra || {});
    },

    render(text, vars) {
      return String(text || '').replace(PLACEHOLDER, (m, k) => (vars[k] != null ? vars[k] : ''));
    },

    params(text, vars) {
      const out = [];
      String(text || '').replace(PLACEHOLDER, (m, k) => { out.push(vars[k] != null && vars[k] !== '' ? String(vars[k]) : '-'); return m; });
      return out;
    },

    link(phone, text) {
      return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
    },

    mode() {
      return DB.settings.waMode === 'API' ? 'API' : 'LINK';
    },

    // Automatic sending is done by the server, which holds the WhatsApp access token
    serverStatus: null,
    async loadStatus() {
      try { WA.serverStatus = (await DB.api('integrations')).whatsapp; } catch (e) { WA.serverStatus = null; }
      return WA.serverStatus;
    },

    apiReady() {
      return !!(WA.serverStatus && WA.serverStatus.tokenSet && WA.serverStatus.phoneNumberId);
    },

    async sendTemplate(phone, tpl, vars) {
      if (!tpl.waTemplateName) throw new Error('Template "' + tpl.name + '" has no approved WhatsApp template name');
      try {
        const res = await DB.api('whatsapp/send', { method: 'POST', body: { to: phone, template: tpl.waTemplateName, language: tpl.waLanguage || 'en', params: WA.params(tpl.body, vars) } });
        return res.id || '';
      } catch (e) {
        throw new Error(DB.errorText(e));
      }
    },

    log(entry) {
      DB.insert('waLog', Object.assign({ at: new Date().toISOString(), by: Auth.user ? Auth.user.username : '' }, entry));
    },

    // Birthday / anniversary wishes that fall within the "days before" window and were not sent yet
    dueWishes() {
      const days = U.n(DB.settings.waDaysBefore) || 7;
      const types = DB.settings.waAnniversary === false ? ['Birthday'] : ['Birthday', 'Anniversary'];
      const sent = DB.all('waLog').filter((l) => l.occasionDate && l.status !== 'failed');
      return Biz.upcomingEvents(days)
        .filter((e) => types.includes(e.type))
        .filter((e) => !sent.some((l) => l.partyId === e.customer.id && l.type === e.type && l.occasionDate === e.date))
        .map((e) => Object.assign(e, { phone: WA.normalizePhone(e.customer.phone) }));
    },

    templatesFor(type) {
      return DB.all('waTemplates').filter((t) => t.type === type && t.active !== false);
    },
  };

  global.WA = WA;
})(window);
