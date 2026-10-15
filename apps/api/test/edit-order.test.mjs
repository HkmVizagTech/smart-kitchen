// Changing an order after it is placed.
//
// The commonest complaint was that a mistyped plate count could not be undone
// without telephoning the kitchen. A booker can now correct their own order —
// but only while nothing has been done with it. These are the refusals that
// make that safe, as much as the success case.
//
//   API=... TEST_PASSWORD=... node test/edit-order.test.mjs

const API = process.env.API || 'http://127.0.0.1:4200';
const PASSWORD = process.env.TEST_PASSWORD || 'devpass';
let pass = 0, fail = 0;
const ck = (o, l) => o ? (pass++, console.log('PASS ', l)) : (fail++, console.log('FAIL ', l));

async function login(u) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: u, password: PASSWORD }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.token) return d.token;
    if (r.status !== 429) throw new Error(`login ${u}: ${r.status} ${d.error ?? ''}`);
    const w = Number(String(d.error ?? '').match(/(\d+) second/)?.[1] ?? 10) + 1;
    console.log(`      (rate limited, waiting ${w}s)`);
    await new Promise((x) => setTimeout(x, w * 1000));
  }
  throw new Error(`login ${u}: still rate limited`);
}
const call = (t, p, o = {}) => fetch(API + p, { ...o,
  headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(o.headers || {}) } });
const json = async (t, p, o) => { const r = await call(t, p, o); return { status: r.status, body: await r.json().catch(() => null) }; };

const a = await login('booking'), b = await login('booker2');
const kitchen = await login('kitchen'), admin = await login('admin');
const TOM = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const units = (await json(admin, '/admin/units')).body;

const menu = (await json(a, `/menu?date=${TOM}&session=BREAKFAST`)).body;
const slots = {}; (menu.slots || []).forEach((s) => { if (s.group) slots[s.group] = 100; });

const placed = await json(a, '/orders', { method: 'POST',
  body: JSON.stringify({ date: TOM, session: 'BREAKFAST', slots, unitId: units[0].id }) });
ck(placed.status === 200, `an order is placed (${placed.status})`);
const id = placed.body.id;
const before = placed.body.totalPlates;

let mine = (await json(a, '/bookings/recent')).body.find((o) => o.id === id);
ck(mine?.canEdit === true, 'the list says it can still be changed');
ck(JSON.stringify(mine?.slots) === JSON.stringify(slots), 'and carries the counts back for prefilling');

// ------------------------------------------------ someone else's is refused
const notYours = await json(b, `/orders/${id}`, { method: 'PATCH',
  body: JSON.stringify({ slots: { ITEM1: 1 } }) });
ck(notYours.status === 403, `another booker cannot change it (${notYours.status})`);

// ------------------------------------------------ a real change
const half = {}; Object.keys(slots).forEach((k) => { half[k] = 50; });
const edit = await json(a, `/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ slots: half }) });
ck(edit.status === 200, `the booker changes it (${edit.status})`);
ck(edit.body.totalPlates === 150 && before === 300,
   `the total moved ${before} → ${edit.body.totalPlates}`);

const kRows = (await json(kitchen, `/orders?date=${TOM}&session=BREAKFAST`)).body;
const kRow = kRows.find((o) => o.id === id);
ck(kRow?.totalPlates === 150, 'the kitchen sees the new total');
const idly = kRow.items.find((it) => it.plates === 50);
ck(!!idly, 'and the line items were rebuilt, not left at the old counts');

// accompaniments must be re-derived from the NEW counts
const sambar = kRow.items.find((it) => it.plates === 100);
ck(!!sambar, 'accompaniments re-derived too (50 + 50 = 100 plates of sambar)');

// ------------------------------------------------ zero is not a change, it is a cancellation
const zero = await json(a, `/orders/${id}`, { method: 'PATCH',
  body: JSON.stringify({ slots: { ITEM1: 0, ITEM2: 0, ITEM3: 0 } }) });
ck(zero.status === 422, `emptying every count is refused (${zero.status})`);

// ------------------------------------------------ once the kitchen starts, it is too late
await json(kitchen, `/orders/${id}/status`, { method: 'POST', body: JSON.stringify({ status: 'PREPARING' }) });
const started = await json(a, `/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ slots: half }) });
ck(started.status === 409, `once the kitchen has started it, no (${started.status})`);
ck(/already started/i.test(started.body?.error ?? ''), 'and it says why');

mine = (await json(a, '/bookings/recent')).body.find((o) => o.id === id);
ck(mine?.canEdit === false, 'the list stops offering the change');

// ------------------------------------------------ an admin may still fix one
const adminFix = await json(admin, `/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ slots: half }) });
ck(adminFix.status === 409, 'not even an admin, once the kitchen has started');

// ------------------------------------------------ lunch changes by headcount
const lunch = await json(b, '/orders', { method: 'POST', body: JSON.stringify({
  date: new Date().toISOString().slice(0, 10), session: 'LUNCH', peopleCount: 30, unitId: units[2].id }) });
if (lunch.status === 200) {
  const l = await json(b, `/orders/${lunch.body.id}`, { method: 'PATCH', body: JSON.stringify({ peopleCount: 45 }) });
  ck(l.status === 200 && l.body.totalPlates === 45, `lunch changes by headcount (${l.status}, ${l.body?.totalPlates})`);
  const bad = await json(b, `/orders/${lunch.body.id}`, { method: 'PATCH', body: JSON.stringify({ peopleCount: 0 }) });
  ck(bad.status === 422, `zero people is refused (${bad.status})`);
} else {
  console.log(`SKIP  lunch window closed (${lunch.body?.error})`);
}

console.log(`\n${fail === 0 ? 'All' : `${pass}/${pass + fail}`} checks passed${fail ? ` — ${fail} FAILED` : '.'}`);
process.exit(fail ? 1 : 0);
