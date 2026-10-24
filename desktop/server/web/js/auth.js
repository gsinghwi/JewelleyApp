/* JewelleryApp - sign in with the server (PocketBase "staff" logins), branded login page,
 * forced password change on first login */
(function (global) {
  'use strict';

  const esc = U.esc;

  const Auth = {
    user: null,

    fromRecord(r) {
      return { id: r.id, username: r.username, name: r.name || r.username, role: r.role, branchId: r.branchId,
        isMaster: !!r.isMaster, active: !!r.active, mustChangePassword: !!r.mustChangePassword };
    },

    // Resume a saved session (token kept by the PocketBase SDK)
    async restore() {
      const pb = DB.pb;
      if (!pb.authStore.isValid || !pb.authStore.record || pb.authStore.record.collectionName !== 'staff') return null;
      try {
        const res = await pb.collection('staff').authRefresh();
        if (!res.record.active) { this.logout(); return null; }
        this.user = this.fromRecord(res.record);
      } catch (e) {
        this.logout();
        return null;
      }
      return this.user;
    },

    async login(username, password) {
      const res = await DB.pb.collection('staff').authWithPassword(String(username).trim(), password);
      if (!res.record.active) {
        this.logout();
        throw new Error('This login is disabled. Ask the head office Admin.');
      }
      this.user = this.fromRecord(res.record);
      return this.user;
    },

    logout() {
      this.user = null;
      DB.pb.authStore.clear();
    },

    async changePassword(current, next) {
      const pb = DB.pb;
      await pb.collection('staff').update(this.user.id, { oldPassword: current, password: next, passwordConfirm: next });
      // changing the password signs out existing sessions: sign in again with the new one
      const res = await pb.collection('staff').authWithPassword(this.user.username, next);
      this.user = this.fromRecord(res.record);
    },

    can(roles) {
      return !!this.user && (!roles || roles.includes(this.user.role));
    },

    mustChangePassword() {
      return !!(this.user && this.user.mustChangePassword);
    },

    renderLogin(root, onSuccess) {
      const s = DB.settings;
      const bg = s.loginBg ? 'background-image:linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.55)),url(' + s.loginBg + ')' : '';
      root.innerHTML =
        '<div class="login">' +
        '<section class="login-brand" style="' + esc(bg) + '">' +
        '<div class="login-brand-inner">' +
        (s.logo ? '<img class="login-logo" src="' + esc(s.logo) + '" alt="">' : '<div class="login-mono">' + esc((s.shopName || 'J').charAt(0)) + '</div>') +
        '<h1>' + esc(s.shopName || 'JewelleryApp') + '</h1>' +
        '<p class="login-tagline">' + esc(s.tagline || '') + '</p>' +
        '<div class="login-meta">' + esc(s.address || '') + (s.phone ? '<br>' + esc(s.phone) : '') + '</div>' +
        '</div></section>' +
        '<section class="login-form-wrap"><form class="login-form" autocomplete="on">' +
        '<h2>Sign in</h2><p class="muted">' + esc(s.loginWelcome || '') + '</p>' +
        '<div class="field"><label for="lg_user">Username</label><input id="lg_user" name="username" autocomplete="username" required></div>' +
        '<div class="field"><label for="lg_pass">Password</label><input id="lg_pass" name="password" type="password" autocomplete="current-password" required></div>' +
        '<div class="login-error" hidden></div>' +
        '<button class="btn primary block" type="submit">Sign in</button>' +
        '<p class="powered">JewelleryApp</p>' +
        '</form></section></div>';

      const form = root.querySelector('form');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = root.querySelector('.login-error');
        const btn = form.querySelector('button');
        btn.disabled = true;
        btn.textContent = 'Signing in...';
        try {
          await Auth.login(form.username.value, form.password.value);
          await onSuccess(Auth.user);
        } catch (ex) {
          err.textContent = ex.status === 400 || ex.status === 401 ? 'Invalid username or password' :
            ex.status === 0 ? 'Cannot reach the JewelleryApp database. Is the service running?' : (ex.message || 'Sign in failed');
          err.hidden = false;
          form.password.value = '';
          form.password.focus();
          btn.disabled = false;
          btn.textContent = 'Sign in';
        }
      });
      setTimeout(() => { if (!form.contains(document.activeElement)) form.username.focus(); }, 30);
    },

    // Full-screen form shown until a new password is set (first login, or after an Admin reset)
    renderChangePassword(root, onDone) {
      root.innerHTML =
        '<div class="login"><section class="login-form-wrap" style="grid-column:1/-1"><form class="login-form" data-nosubmit>' +
        '<h2>Set your password</h2><p class="muted">Hello ' + esc(this.user.name) + '. For security, choose a new password before you start. ' +
        'Use at least 8 characters, and do not reuse the default password.</p>' +
        '<div class="field"><label>Current password</label><input type="password" name="current" autocomplete="current-password" required></div>' +
        '<div class="field"><label>New password</label><input type="password" name="next" autocomplete="new-password" required minlength="8"></div>' +
        '<div class="field"><label>Confirm new password</label><input type="password" name="confirm" autocomplete="new-password" required></div>' +
        '<div class="login-error" hidden></div>' +
        '<button class="btn primary block" type="submit">Save password and continue</button>' +
        '<button class="btn ghost block" type="button" data-signout>Sign out</button></form></section></div>';
      const form = root.querySelector('form');
      const err = root.querySelector('.login-error');
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      root.querySelector('[data-signout]').addEventListener('click', () => { Auth.logout(); location.reload(); });
      form.querySelector('button[type=submit]').addEventListener('click', async () => {
        const cur = form.current.value, next = form.next.value, conf = form.confirm.value;
        if (next.length < 8) return fail('The new password must have at least 8 characters.');
        if (next !== conf) return fail('The two new passwords do not match.');
        if (next === cur || ['admin123', 'password', '12345678'].includes(next)) return fail('Choose a different, stronger password.');
        try {
          await Auth.changePassword(cur, next);
          UI.toast('Password changed');
          onDone();
        } catch (ex) {
          fail(DB.errorText(ex).replace(/oldPassword/i, 'Current password'));
        }
      });
      setTimeout(() => form.current.focus(), 30);
    },
  };

  global.Auth = Auth;
})(window);
