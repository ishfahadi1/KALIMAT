// Reports: which calendar day an order belongs to. The shop works in Rwanda time (UTC+2), not UTC.
process.env.TZ = 'UTC'; // the admin may be opened on a device set to any time zone; the shop calendar must not depend on it
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const FILE = process.env.ADMIN_FILE || path.join(__dirname, '..', '..', 'admin.html');
const src = fs.readFileSync(FILE, 'utf8');
const a = src.indexOf('//#region src/lib/finance.ts'), b = src.indexOf('//#endregion', a);
assert.ok(a > 0 && b > a, 'finance region found');
const ctx = { window: { parent: { KCFG: { TIMEZONE: 'Africa/Kigali' } } }, Intl, Date, Math, Number, String, Array, Object, isNaN };
vm.createContext(ctx);
vm.runInContext(src.slice(a, b) + '\n;this.F={inRange,rangeFromDays,today,countsAsSale};', ctx);
const F = ctx.F;

test('BUG-006 an order placed at 01:30 Kigali time belongs to THAT day, not the previous UTC day', () => {
  const o = '2026-10-19T23:30:00.000Z'; // = 2026-10-20 01:30 in Kigali
  assert.equal(F.inRange(o, '2026-10-20', '2026-10-20'), true);
  assert.equal(F.inRange(o, '2026-10-19', '2026-10-19'), false);
});
test('BUG-006b midnight boundary: 23:59:59 Kigali is still the day, 00:00:00 Kigali is the next day', () => {
  assert.equal(F.inRange('2026-10-20T21:59:59.000Z', '2026-10-20', '2026-10-20'), true);
  assert.equal(F.inRange('2026-10-20T22:00:00.000Z', '2026-10-20', '2026-10-20'), false);
  assert.equal(F.inRange('2026-10-20T22:00:00.000Z', '2026-10-21', '2026-10-21'), true);
});
test('range ends are inclusive and a date-only value is taken as written', () => {
  assert.equal(F.inRange('2026-10-20', '2026-10-20', '2026-10-20'), true);
  assert.equal(F.inRange('2026-10-19', '2026-10-20', '2026-10-21'), false);
  assert.equal(F.inRange('2026-10-22', '2026-10-20', '2026-10-21'), false);
});
test('a 7-day preset covers exactly 7 calendar days ending today (Kigali)', () => {
  const r = F.rangeFromDays(7), d = (s) => Date.parse(s + 'T00:00:00Z');
  assert.equal((d(r.to) - d(r.from)) / 864e5, 6);
  assert.equal(r.to, F.today());
});
test('every matching order in the period is included (not just one)', () => {
  const orders = ['2026-10-18T10:00:00Z', '2026-10-19T23:30:00Z', '2026-10-20T08:00:00Z', '2026-10-20T21:00:00Z', '2026-10-21T01:00:00Z', '2026-10-17T10:00:00Z'].map((date, i) => ({ id: i, date, status: 'delivered', amount: 10 }));
  const inR = orders.filter((o) => F.countsAsSale(o) && F.inRange(o.date, '2026-10-18', '2026-10-20'));
  assert.equal(inR.length, 4, 'Oct 18, Oct 20 (01:30 local), Oct 20, Oct 20 (23:00 local) -> 4 rows; Oct 17 and Oct 21 (03:00 local) excluded');
});
