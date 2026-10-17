// KALIMAT service worker.
// - The storefront (/) is installable and reopens offline from the last good copy.
// - Admin pages and the backend are NEVER cached and never used as an offline fallback.
// - Only successful same-origin GET responses are stored, so an error page can't replace a good copy.
// Bump VERSION whenever the precache list or the caching rules change.
const VERSION = 'kalimat-v3';
const SHELL = [
  '/', '/index.html', '/config.js',
  '/assets/css/store.css', '/assets/js/kdb.js', '/assets/js/store.js',
  '/manifest.webmanifest', '/logo-transparent.png',
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
