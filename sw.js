// KALIMAT service worker.
// - The storefront (/) is installable and reopens offline from the last good copy.
// - Admin pages and the backend are NEVER cached and never used as an offline fallback.
// - Only successful same-origin GET responses are stored, so an error page can't replace a good copy.
// Bump VERSION whenever the precache list or the caching rules change.
const VERSION = 'kalimat-v6';
const SHELL = [
  '/', '/index.html', '/config.js',
  '/assets/css/store.css', '/assets/js/kdb.js', '/assets/js/store.js',
  '/manifest.webmanifest', '/logo-transparent.png',
  '/assets/js/push.js',
  '/favicon.ico', '/favicon-32.png', '/apple-touch-icon.png',
  '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png'
];
// /admin, /admin/..., /admin.html and anything under /supabase: pass straight to the network.
const PRIVATE = /^\/(admin(\.html)?\/?|admin\/.*|supabase\/.*)$/;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase, Cloudinary, fonts: always network
  if (PRIVATE.test(url.pathname)) return;             // admin + backend: not intercepted at all
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const isPage = req.mode === 'navigate';
    const hit = await cache.match(req, { ignoreSearch: isPage });
    if (hit) return hit;
    if (isPage) {
      const shell = await cache.match('/index.html');
      if (shell) return shell;
    }
    return Response.error();
  }
}

// ---- Push notifications (admin: new orders / customers, shoppers: new products) ----
// Every push shows a notification (iPhone requires it) and raises the app-icon badge by one.
// The app clears the badge and resets the count when it is opened (see assets/js/push.js).
function idb() {
  return new Promise((ok, no) => {
    const r = indexedDB.open('kal-push', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}
async function badge(fn) {
  try {
    const db = await idb();
    return await new Promise((ok) => {
      const tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv'), g = st.get('n');
      g.onsuccess = () => { const n = fn(Number(g.result) || 0); st.put(n, 'n'); tx.oncomplete = () => ok(n); };
      g.onerror = () => ok(0);
    });
  } catch (e) { return 0; }
}
async function setBadge(n) {
  try {
    if (n > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(n);
    else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
  } catch (e) {}
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let d = {};
    try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach((w) => w.postMessage({ type: 'kal-push', data: d }));   // open pages refresh their feed
    const n = await badge((x) => x + 1);
    await setBadge(n);
    await self.registration.showNotification(d.title || 'KALIMAT', {
      body: d.body || '',
      icon: d.icon || '/icon-192.png',
      badge: '/favicon-32.png',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      data: { url: d.url || '/' }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    await badge(() => 0);
    await setBadge(0);
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = new URL(url, self.location.origin);
    for (const w of wins) {
      const u = new URL(w.url);
      if (u.origin === target.origin && (u.pathname === target.pathname || (target.pathname === '/admin' && u.pathname.startsWith('/admin')))) {
        try { await w.focus(); return; } catch (e) {}
      }
    }
    await self.clients.openWindow(target.href);
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'kal-reset') event.waitUntil((async () => { await badge(() => 0); await setBadge(0); })());
});
