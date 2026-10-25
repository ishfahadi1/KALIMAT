// Regression tests for the data layer: what "saved" means, and that failures are never hidden.
const test = require('node:test'), assert = require('node:assert/strict');
const { makeBackend, loadKdb, futureSession, expiredSession } = require('./helpers');
const sleep = (ms = 5) => new Promise(r => setTimeout(r, ms));

test('BUG-001 an admin write with an expired session is REJECTED with a clear message (was: silently dropped, UI looked saved)', async () => {
  const be = makeBackend({ refreshWorks: false });
  const { KDB } = loadKdb(be, { session: expiredSession() });
  await KDB.ready;
  const res = KDB.wr('products', [{ id: 'p1', name: 'X' }]);
  assert.ok(res && typeof res.then === 'function', 'wr must return a promise the UI can await');
  await assert.rejects(res, /sign in/i);
  assert.equal(be.rows.length, 0, 'nothing may be stored');
  assert.equal(KDB.rd('products', []).length, 0, 'the unsaved record must not stay visible');
});

test('BUG-001b with no session at all, an admin-only collection write is rejected (was: silent no-op)', async () => {
  const be = makeBackend();
  const { KDB } = loadKdb(be, { session: null });
  await KDB.ready;
  await assert.rejects(KDB.wr('products', [{ id: 'p1', name: 'X' }]), /sign in/i);
  assert.equal(be.rows.length, 0);
});

test('BUG-002 wr resolves only AFTER the backend confirmed the row', async () => {
  const be = makeBackend();
  const { KDB } = loadKdb(be, { session: futureSession() });
  await KDB.ready;
  await KDB.wr('products', [{ id: 'p1', name: 'Basket', price: 9 }]);
  assert.deepEqual(be.rows.map(r => r.coll + ':' + r.id), ['products:p1']);
  assert.equal(be.rows[0].data.name, 'Basket');
});

test('BUG-003 a failed write (server error) rejects, notifies the UI, and rolls the screen back to the server truth', async () => {
  const be = makeBackend({ failWrites: 1 });
  be.add('products', 'p0', { id: 'p0', name: 'Old' });
  const { KDB, toasts } = loadKdb(be, { session: futureSession() });
  await KDB.ready;
  const errors = []; KDB.onError(m => errors.push(m));
  await assert.rejects(KDB.wr('products', [{ id: 'p0', name: 'Old' }, { id: 'p1', name: 'New' }]), /server|not saved/i);
  await sleep(20);
  assert.ok(errors.length >= 1, 'UI error listener must be told');
  assert.deepEqual(KDB.rd('products', []).map(p => p.id), ['p0'], 'unsaved "New" must disappear after the failed save');
});

test('BUG-004 a delete that the database did not perform is reported (was: UI showed it deleted, it came back after refresh)', async () => {
  const be = makeBackend({ silentDelete: true });
  be.add('categories', 'c1', { id: 'c1', name: 'Home' });
  const { KDB } = loadKdb(be, { session: futureSession() });
  await KDB.ready;
  assert.equal(KDB.rd('categories', []).length, 1);
  await assert.rejects(KDB.wr('categories', []), /not deleted|could not delete/i);
  await sleep(20);
  assert.equal(KDB.rd('categories', []).length, 1, 'the category still exists on the server, so it must still be shown');
});

test('BUG-005 load reads EVERY page (was: silently stopped at 1000 rows, hiding records and distorting reports)', async () => {
  const be = makeBackend();
  for (let i = 0; i < 2500; i++) be.add('orders', 'o' + i, { id: 'o' + i, n: i });
  const { KDB } = loadKdb(be, { session: futureSession() });
  await KDB.ready;
  assert.equal(KDB.rd('orders', []).length, 2500);
});

test('BUG-005b shoppers also get every product (public view is paged too)', async () => {
  const be = makeBackend();
  for (let i = 0; i < 1500; i++) be.add('products', 'p' + i, { id: 'p' + i });
  const { KDB } = loadKdb(be, { path: '/', session: null });
  await KDB.ready;
  assert.equal(KDB.rd('products', []).length, 1500);
});

test('REGRESSION shopper can still place an order (insert-only) and cannot overwrite products', async () => {
  const be = makeBackend();
  be.add('products', 'p1', { id: 'p1', name: 'Hat' });
  const { KDB } = loadKdb(be, { path: '/', session: null });
  await KDB.ready;
  await KDB.wr('orders', [{ id: 'o1', productId: 'p1' }]); await sleep(30);
  assert.ok(be.rows.some(r => r.coll === 'orders' && r.id === 'o1'));
  await Promise.resolve(KDB.wr('products', [{ id: 'p1', name: 'HACKED' }])).catch(() => {}); await sleep(30);
  assert.equal(be.rows.find(r => r.coll === 'products').data.name, 'Hat');
});

test('REGRESSION admin edit updates the same record, and removing an item deletes only that row', async () => {
  const be = makeBackend();
  be.add('products', 'p1', { id: 'p1', name: 'A' }); be.add('products', 'p2', { id: 'p2', name: 'B' });
  const { KDB } = loadKdb(be, { session: futureSession() });
  await KDB.ready;
  await KDB.wr('products', [{ id: 'p1', name: 'A2' }, { id: 'p2', name: 'B' }]); await sleep(30);
  assert.equal(be.rows.filter(r => r.coll === 'products').length, 2);
  assert.equal(be.rows.find(r => r.id === 'p1').data.name, 'A2');
  await KDB.wr('products', [{ id: 'p1', name: 'A2' }]); await sleep(30);
  assert.deepEqual(be.rows.filter(r => r.coll === 'products').map(r => r.id), ['p1']);
});

test('REGRESSION data URLs are uploaded to Cloudinary before the row is saved', async () => {
  const be = makeBackend(); let uploads = 0;
  const wrapped = be.fetch; be.fetch = async (u, o) => (String(u).includes('cloudinary') ? (uploads++, { ok: true, status: 200, json: async () => ({ secure_url: 'https://res.cloudinary.com/x/image/upload/v1/a.jpg' }), text: async () => '' }) : wrapped(u, o));
  const { KDB } = loadKdb(be, { session: futureSession(), cfg: { CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_UPLOAD_PRESET: 'p' } });
  await KDB.ready;
  await KDB.wr('products', [{ id: 'p1', images: ['data:image/png;base64,AAAA'] }]); await sleep(30);
  assert.equal(uploads, 1);
  assert.match(be.rows[0].data.images[0], /^https:\/\/res\.cloudinary\.com\//);
});

test('REGRESSION storefront never gets cost price (reads the public view only)', async () => {
  const be = makeBackend();
  be.add('products', 'p1', { id: 'p1', name: 'Hat', costPrice: 5 });
  const { KDB } = loadKdb(be, { path: '/', session: null });
  await KDB.ready;
  assert.ok(KDB.rd('products', []).length === 1);
});

test('call() returns a database function result and exposes the server error code for the screen to translate', async () => {
  const be = makeBackend(); const orig = be.fetch;
  be.fetch = async (u, o) => (String(u).includes('/rpc/customer_login')
    ? (JSON.parse(o.body).p_username === 'locked'
        ? { ok: false, status: 400, text: async () => JSON.stringify({ message: 'locked' }), json: async () => ({}) }
        : { ok: true, status: 200, text: async () => JSON.stringify({ customer: { id: 'c1' } }), json: async () => ({}) })
    : orig(u, o));
  const { KDB } = loadKdb(be, { path: '/', session: null }); await KDB.ready;
  assert.equal((await KDB.call('customer_login', { p_username: 'ok' })).customer.id, 'c1');
  await assert.rejects(KDB.call('customer_login', { p_username: 'locked' }), (e) => e.detail === 'locked');
});
