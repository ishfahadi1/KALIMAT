// Test harness: runs the REAL assets/js/kdb.js inside a vm against an in-memory fake of Supabase (PostgREST + Auth).
// The fake enforces the same rules as the production RLS policies (see supabase/migrations/001-002).
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_COLLS = ['config', 'categories', 'promotions', 'policies', 'businessProfile', 'tutorial'];
const SHOPPER_INSERT = ['orders', 'customers', 'customerDemands'];

function makeBackend(opts = {}) {
  const b = { rows: [], calls: [], refreshWorks: true, failWrites: 0, silentDelete: false, rlsAdmin: 'adm-token', ...opts };
  b.add = (coll, id, data, shop = 's1') => { b.rows.push({ shop_id: shop, coll, id, data }); };
  b.fetch = async (url, o = {}) => {
    const method = o.method || 'GET', hdr = o.headers || {}, auth = hdr.Authorization || '', admin = auth === 'Bearer ' + b.rlsAdmin;
    b.calls.push({ method, url, admin });
    const J = (body, status = 200) => ({ ok: status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)), json: async () => body });
    const u = new URL(url), p = u.pathname;
    if (p.includes('/auth/v1/token')) return b.refreshWorks ? J({ access_token: b.rlsAdmin, refresh_token: 'r2', expires_in: 3600 }) : J({ error: 'invalid_grant' }, 400);
    if (p.includes('/rpc/public_products')) {
      const off = +u.searchParams.get('offset') || 0, lim = Math.min(+u.searchParams.get('limit') || 1000, 1000);
      return J(b.rows.filter(r => r.coll === 'products').slice(off, off + lim).map(r => ({ id: r.id, data: r.data })));
    }
    if (p.includes('/rpc/')) return J(true);
    if (p.endsWith('/rest/v1/records')) {
      if (method === 'GET') {
        const off = +u.searchParams.get('offset') || 0, lim = Math.min(+u.searchParams.get('limit') || 1000, 1000);
        const fc = u.searchParams.get('coll'), fi = u.searchParams.get('id');
        const vis = b.rows.filter(r => (admin || PUBLIC_COLLS.includes(r.coll)) && (!fc || r.coll === fc.replace(/^eq\./, '')) && (!fi || r.id === fi.replace(/^eq\./, '')));
        return J(vis.slice(off, off + lim).map(r => ({ coll: r.coll, id: r.id, data: r.data })));
      }
      if (method === 'POST') {
        if (b.failWrites > 0) { b.failWrites--; return J({ message: 'boom' }, 500); }
        const row = JSON.parse(o.body);
        if (!admin && !SHOPPER_INSERT.includes(row.coll)) return J({ code: '42501', message: 'new row violates row-level security policy' }, 401);
        const i = b.rows.findIndex(r => r.shop_id === row.shop_id && r.coll === row.coll && r.id === row.id);
        if (i >= 0 && !admin) return J({ code: '23505', message: 'duplicate key' }, 409);
        if (i >= 0) b.rows[i] = row; else b.rows.push(row);
        return /representation/.test(hdr.Prefer || '') ? J([row], 201) : J(undefined, 201);
      }
      if (method === 'DELETE') {
        const id = u.searchParams.get('id').replace(/^eq\./, ''), coll = u.searchParams.get('coll').replace(/^eq\./, '');
        if (b.silentDelete || !admin) return /representation/.test(hdr.Prefer || '') ? J([], 200) : J(undefined, 204);
        const gone = b.rows.filter(r => r.coll === coll && r.id === id); b.rows = b.rows.filter(r => !(r.coll === coll && r.id === id));
        return /representation/.test(hdr.Prefer || '') ? J(gone, 200) : J(undefined, 204);
      }
    }
    return J({}, 404);
  };
  return b;
}

// Loads kdb.js fresh. mode: 'admin' (default for /admin) or 'shop'.
function loadKdb(backend, { path: pathname = '/admin', session = null, cfg = {} } = {}) {
  const store = {};
  if (session) store['kdb.session'] = JSON.stringify(session);
  const listeners = {};
  const win = {
    KCFG: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SHOP_ID: 's1', ...cfg },
    toast: () => {}, addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    dispatchEvent: (e) => { (listeners[e.type] || []).forEach(f => f(e)); return true; },
  };
  const toasts = []; win.toast = (m) => toasts.push(m);
  const ctx = {
    window: win, console: { error() {}, warn() {}, log() {} }, fetch: backend.fetch, Promise, JSON, Date, Object, Array, String, Math, Error, URL, URLSearchParams,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { pathname }, FormData: class { append() {} }, encodeURIComponent, setInterval: () => 0, setTimeout, clearTimeout,
    document: { hidden: false, head: { appendChild() {} }, createElement: () => ({}), addEventListener() {} },
  };
  ctx.window.window = ctx.window; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/kdb.js'), 'utf8'), ctx);
  return { KDB: ctx.window.KDB, toasts, store, win, ctx };
}
const futureSession = (email = 'a@b.c') => ({ at: 'adm-token', rt: 'r', exp: Math.floor(Date.now() / 1000) + 3600, email });
const expiredSession = (email = 'a@b.c') => ({ at: 'old', rt: 'r', exp: Math.floor(Date.now() / 1000) - 10, email });
module.exports = { makeBackend, loadKdb, futureSession, expiredSession, ROOT };
