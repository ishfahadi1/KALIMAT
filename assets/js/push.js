/* KALIMAT notifications + app-icon badge. Loaded by the storefront (index.html) and the admin (admin.html).
   - Admin phones get: new order, new customer.   Shoppers get: new product.
   - A push needs the person's OK, so a small bar asks once (a tap is required by every browser).
   - The number on the app icon = things that arrived since the app was last open. Opening the app clears it. */
(function () {
  var C = window.KCFG || {}, H = (C.SUPABASE_URL || '').replace(/\/$/, ''), A = C.SUPABASE_ANON_KEY || '', SHOP = C.SHOP_ID || '';
  var ADMIN = /^\/admin/.test(location.pathname);
  var CAN = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  var IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var STANDALONE = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var SEEN = 'kal.adm.seen', NOASK = 'kal.push.later';

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  /* ---- "what's new since I was last here" (admin) ---- */
  var seenAt = (function () {
    var v = Number(get(SEEN));
    if (!v) { v = Date.now(); set(SEEN, String(v)); }   // first ever visit: nothing is "new" yet
    return v;
  })();
  function markSeen() { set(SEEN, String(Date.now())); }

  /* ---- icon badge (Chrome/Edge/Android installed app, Safari 16.4+ home-screen app) ---- */
  function badge(n) {
    try {
      if (n > 0 && navigator.setAppBadge) navigator.setAppBadge(n).catch(function () {});
      else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(function () {});
    } catch (e) {}
  }
  function resetWorker() {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: 'kal-reset' });
    } catch (e) {}
  }
  function opened() { resetWorker(); if (!ADMIN) badge(0); }   // admin: the dashboard sets the badge from its own feed

  /* ---- talking to the kal-push edge function ---- */
  async function call(body, auth) {
    var tok = null;
    if (auth && window.KDB && KDB.token) { try { tok = await KDB.token(); } catch (e) {} }
    var r = await fetch(H + '/functions/v1/kal-push', {
      method: 'POST',
      headers: { apikey: A, Authorization: 'Bearer ' + (tok || A), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var d = null; try { d = await r.json(); } catch (e) {}
    return { ok: r.ok, d: d };
  }
  function u8(b64) {
    var p = '='.repeat((4 - (b64.length % 4)) % 4), s = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')), o = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
    return o;
  }
  function b64(buf) {
    var s = '', b = new Uint8Array(buf);
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function subscribe() {
    var reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () { return null; });
    reg = await navigator.serviceWorker.ready;
    var k = await call({ action: 'key' });
    if (!k.ok || !k.d || !k.d.publicKey) throw new Error('no_key');
    var sub = await reg.pushManager.getSubscription();
    if (sub && sub.options && sub.options.applicationServerKey && b64(sub.options.applicationServerKey) !== k.d.publicKey) {
      await sub.unsubscribe(); sub = null;   // keys were replaced on the server: start fresh
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(k.d.publicKey) });
    var r = await call({ action: 'subscribe', shop_id: SHOP, role: ADMIN ? 'admin' : 'customer', subscription: sub.toJSON() }, ADMIN);
    if (!r.ok) throw new Error('subscribe_' + (r.d && r.d.error));
    return true;
  }

  /* ---- the little "turn on alerts" bar ---- */
  var bar = null;
  function hide() { if (bar && bar.parentNode) bar.parentNode.removeChild(bar); bar = null; }
  function show(text, btn, onTap, onLater) {
    if (bar) return;
    bar = document.createElement('div');
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Notifications');
    bar.style.cssText = 'position:fixed;z-index:2147483000;left:50%;transform:translateX(-50%);max-width:min(92vw,420px);width:max-content;' +
      (ADMIN ? 'top:52px;' : 'bottom:78px;') +
      'display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:#14210d;color:#fff;box-shadow:0 8px 28px rgba(0,0,0,.28);font:500 13px/1.3 Inter,system-ui,sans-serif';
    var t = document.createElement('span'); t.textContent = text; t.style.cssText = 'flex:1;min-width:0';
    bar.appendChild(t);
    if (btn) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = btn;
      b.style.cssText = 'flex:none;border:0;border-radius:10px;padding:8px 12px;background:#7fd33f;color:#10200a;font:700 13px Inter,system-ui,sans-serif;cursor:pointer';
      b.onclick = onTap; bar.appendChild(b);
    }
    var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Not now'); x.textContent = '×';
    x.style.cssText = 'flex:none;border:0;background:transparent;color:#fff;font:400 22px/1 system-ui;cursor:pointer;padding:0 4px;opacity:.8';
    x.onclick = function () { hide(); onLater && onLater(); };
    bar.appendChild(x);
    document.body.appendChild(bar);
  }

  async function enable() {
    try {
      var p = await Notification.requestPermission();
      if (p !== 'granted') { hide(); return false; }
      await subscribe();
      hide();
      show(ADMIN ? 'Alerts are on for new orders and customers.' : 'You will hear about new products.', null);
      setTimeout(hide, 3500);
      return true;
    } catch (e) {
      console.error('[push]', e);
      hide();
      show('Could not turn on alerts. Check your connection and try again.', 'Retry', enable);
      return false;
    }
  }

  function check() {
    try {
      if (ADMIN && !(window.KDB && KDB.session && KDB.session())) return;   // admin alerts only after sign-in
      if (!CAN) {
        // iPhone only allows alerts for an app that was added to the Home Screen.
        if (ADMIN && IOS && !STANDALONE && !sget('kal.push.ios')) show('For alerts on iPhone: tap Share, then Add to Home Screen, and open it from there.', null, null, function () { sset('kal.push.ios', '1'); });
        return;
      }
      var perm = Notification.permission;
      if (perm === 'granted') { hide(); subscribe().catch(function (e) { console.warn('[push] resync', e); }); return; }
      if (perm === 'denied') {
        if (ADMIN && !sget('kal.push.denied')) show('Alerts are blocked. Allow notifications for this app in your phone or browser settings.', null, null, function () { sset('kal.push.denied', '1'); });
        return;
      }
      if (ADMIN) {
        if (!sget(NOASK)) show('Get an alert on this phone for every new order and customer.', 'Turn on', enable, function () { sset(NOASK, '1'); });
      } else {
        var t = Number(get(NOASK)) || 0;
        if (Date.now() - t > 7 * 864e5) show('Want to hear about new products?', 'Yes, notify me', enable, function () { set(NOASK, String(Date.now())); });
      }
    } catch (e) { console.warn('[push]', e); }
  }

  /* ---- wire up ---- */
  function boot() {
    opened();
    // admin: becomes visible again after being away -> compare against the moment the app was left
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (ADMIN) { markSeen(); badge(0); }
        resetWorker();
      } else {
        if (ADMIN) { seenAt = Number(get(SEEN)) || seenAt; }
        opened();
        if (window.KDB) KDB.load();
        window.dispatchEvent(new Event('kal-refresh'));
      }
    });
    addEventListener('pagehide', function () { if (ADMIN) { markSeen(); badge(0); } resetWorker(); });
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'kal-push' && window.KDB && !document.hidden) KDB.load();
    });
    // Ask (only a tap can) once the page has settled; admin waits for the signed-in session.
    setTimeout(check, ADMIN ? 1500 : 8000);
    if (ADMIN && window.KDB) { var tries = 0, iv = setInterval(function () { if (KDB.session() || ++tries > 120) { clearInterval(iv); check(); } }, 2500); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.KPush = {
    lastSeen: function () { return seenAt; },
    setBadge: badge,
    enable: enable,
    supported: CAN
  };
})();
