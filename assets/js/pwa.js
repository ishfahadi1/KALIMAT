/* KALIMAT PWA helper: service-worker registration, auto-update, and install instructions for every device. */
(function () {
  var admin = /^\/admin/.test(location.pathname);

  // Steps shown when the browser cannot show its own install prompt (iPhone, Safari, Firefox, in-app browsers...).
  window.kalInstallSteps = function () {
    var ua = navigator.userAgent || '';
    var ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (/FBAN|FBAV|Instagram|Line\/|MicroMessenger|TikTok|Snapchat|; wv\)/i.test(ua)) return ['Open this page in your browser (Chrome or Safari) to install.'];
    if (ios) {
      var s = ['Tap the Share button', "Choose 'Add to Home Screen'", 'Tap Add'];
      return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? ['Open this page in Safari first.'].concat(s) : s;
    }
    if (/Android/.test(ua)) {
      if (/SamsungBrowser/.test(ua)) return ['Tap the menu at the bottom of the screen', "Tap 'Add page to', then 'Home screen'", 'Confirm'];
      return ['Tap the browser menu (\u22ee)', "Tap 'Install app' or 'Add to Home Screen'", 'Confirm'];
    }
    if (/Firefox/.test(ua)) return ["Firefox on computers can't install apps. Open this page in Chrome or Edge."];
    if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return ['In Safari open the File menu', "Choose 'Add to Dock'"];
    return ["Click the install icon in the address bar, or open the menu (\u22ee) and choose 'Install app'."];
  };


  // ---- Admin: install button in the top bar (installs the admin as its own app) ----
  function adminInstallButton() {
    var b = document.getElementById('ainst');
    if (!b || b.__kal) return;
    b.__kal = 1;
    var standalone = function () { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; };
    var show = function () { b.hidden = standalone() || !!window.__kalInstalled; };
    show();
    addEventListener('beforeinstallprompt', show);
    addEventListener('appinstalled', function () { window.__kalInstalled = 1; show(); });
    b.onclick = function () {
      var e = window.__kalPrompt;
      if (e) { window.__kalPrompt = null; e.prompt(); if (e.userChoice) e.userChoice.then(show, show); return; }
      var m = document.createElement('div');
      m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
      m.style.cssText = 'position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.6)';
      var c = document.createElement('div');
      c.style.cssText = 'width:100%;max-width:380px;background:#0e1433;color:#f1f3ff;border:1px solid #1f2850;border-radius:20px;padding:20px;font:500 14px/1.4 Inter,system-ui,sans-serif';
      var h = document.createElement('h3'); h.textContent = 'Install KALIMAT Admin'; h.style.cssText = 'margin:0 0 6px;font-size:18px';
      var p = document.createElement('p'); p.textContent = 'It installs on its own, separate from the shop app.'; p.style.cssText = 'margin:0 0 10px;opacity:.75;font-size:13px';
      var ol = document.createElement('ol'); ol.style.cssText = 'margin:0 0 14px;padding-left:20px;display:grid;gap:6px';
      window.kalInstallSteps().forEach(function (s) { var li = document.createElement('li'); li.textContent = s; ol.appendChild(li); });
      var ok = document.createElement('button'); ok.type = 'button'; ok.textContent = 'Got it';
      ok.style.cssText = 'width:100%;padding:11px;border:0;border-radius:12px;font:700 14px system-ui,sans-serif;color:#fff;background:#6366f1;cursor:pointer';
      ok.onclick = function () { m.remove(); };
      c.appendChild(h); c.appendChild(p); c.appendChild(ol); c.appendChild(ok); m.appendChild(c);
      m.addEventListener('click', function (ev) { if (ev.target === m) m.remove(); });
      document.body.appendChild(m);
    };
  }
  if (admin) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', adminInstallButton); else adminInstallButton(); }

  if (!('serviceWorker' in navigator)) return;
  var hadController = !!navigator.serviceWorker.controller, handled = false;

  function banner() {
    if (document.getElementById('kal-upd')) return;
    var d = document.createElement('div');
    d.id = 'kal-upd';
    d.setAttribute('role', 'status');
    d.style.cssText = 'position:fixed;left:12px;right:12px;bottom:14px;z-index:99999;max-width:420px;margin:0 auto;display:flex;gap:10px;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:14px;background:#1f2937;color:#fff;font:600 14px/1.3 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35)';
    d.innerHTML = '<span>A new version is ready.</span>';
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = 'Refresh';
    b.style.cssText = 'border:0;border-radius:10px;padding:8px 14px;background:#fff;color:#111;font:700 13px system-ui,sans-serif;cursor:pointer';
    b.onclick = function () { location.reload(); };
    d.appendChild(b);
    document.body.appendChild(d);
  }

  // A new service worker took over: the storefront reloads itself with the fresh files;
  // the admin only asks, so nobody loses a half-written form.
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!hadController) { hadController = true; return; }   // very first install: nothing to refresh
    if (handled) return; handled = true;
    if (admin) banner(); else location.reload();
  });

  function register() {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(function (reg) {
      var check = function () { reg.update().catch(function () {}); };
      document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
      addEventListener('online', check);
      setInterval(check, 15 * 60 * 1000);
      if (reg.waiting) reg.waiting.postMessage({ type: 'skip' });
    }).catch(function () {});
  }
  if (document.readyState === 'complete') register(); else addEventListener('load', register);
})();
