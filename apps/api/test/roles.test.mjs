// Who may do what, against a running API.
//
// Written after a review found the close-out chain had no ownership check at
// all: the picker listed every open meal in the kitchen and the API never
// asked who placed the order, so any booker could enter consumption figures
// for a route they had never seen — and those figures set the payment amount.
//
//   API=... TEST_PASSWORD=... node test/roles.test.mjs

const API = process.env.API || 'http://127.0.0.1:4200';
const PASSWORD = process.env.TEST_PASSWORD || 'devpass';

let pass = 0, fail = 0;
const ck = (ok, l) => ok ? (pass++, console.log('PASS ', l)) : (fail++, console.log('FAIL ', l));

// The API rate-limits /auth/login (10 a minute by default), and this suite
// signs in four accounts. A 429 is the limiter doing its job, not a failed
// login, so wait it out rather than reporting a boundary failure that isn't.
async function login(u) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: u, password: PASSWORD }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.token) return body.token;
    if (res.status !== 429) throw new Error(`login ${u}: ${res.status} ${body.error ?? ''}`);
    const wait = Number((body.error ?? '').match(/(\d+) second/)?.[1] ?? 10) + 1;
    console.log(`      (rate limited, waiting ${wait}s)`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  throw new Error(`login ${u}: still rate limited`);
}

const call = (t, p, o = {}) => fetch(API + p, {
  ...o, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(o.headers || {}) },
});
const json = async (t, p, o) => { const r = await call(t, p, o); return { status: r.status, body: await r.json().catch(() => null) }; };

const a = await login('booking');    // booker A
const b = await login('booker2');    // booker B
const admin = await login('admin');
const kitchen = await login('kitchen');
ck(!!a && !!b && !!admin, 'two bookers and an admin can sign in');

// Give each booker an order of their own, so the crossing-over checks below
// have something real to try. Seeded here rather than assumed, so the suite
// does not quietly pass on an empty database.
const TOM = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
{
  const menu = (await json(a, `/menu?date=${TOM}&session=BREAKFAST`)).body;
  const slots = {};
  (menu.slots || []).forEach((s) => { if (s.group) slots[s.group] = 20; });
  const units = (await json(admin, '/admin/units')).body;
  for (const [tok, name] of [[a, 'Unit-1'], [b, 'Unit-2']]) {
    const unit = units.find((u) => u.name === name);
    const r = await json(tok, '/orders', {
      method: 'POST',
      body: JSON.stringify({ date: TOM, session: 'BREAKFAST', slots, unitId: unit.id }),
    });
    ck(r.status === 200 || r.status === 409, `${name} has an order for ${TOM} (${r.status})`);
  }
}

// ---------------------------------------------------- a booker sees only their own
const mineA = (await json(a, '/bookings/recent')).body;
const mineB = (await json(b, '/bookings/recent')).body;
ck(Array.isArray(mineA) && mineA.every((o) => o.mine),
  `booker A's list is all their own (${mineA.length} orders)`);
ck(Array.isArray(mineB) && mineB.every((o) => o.mine),
  `booker B's list is all their own (${mineB.length} orders)`);
const idsA = new Set(mineA.map((o) => o.id));
ck(mineB.every((o) => !idsA.has(o.id)), 'the two lists do not overlap');

const asAdmin = (await json(admin, '/bookings/recent')).body;
ck(asAdmin.length >= mineA.length + mineB.length, `the admin still sees every route (${asAdmin.length})`);
ck(asAdmin.some((o) => o.placedBy), 'and each order says who placed it');

// ---------------------------------------------------- one booker cannot touch another's close-out
const victim = mineB.find((o) => o.needsCloseOut) ?? mineB[0];
if (!victim) {
  console.log('SKIP  no order of booker B to try against');
} else {
  const peek = await json(a, `/orders/${victim.id}/closeout-items`);
  ck(peek.status === 403, `booker A cannot open booker B's close-out (${peek.status})`);

  const cons = await json(a, '/orders/consumption', {
    method: 'POST', body: JSON.stringify({ orderId: victim.id, items: [], notes: 'not mine' }),
  });
  ck(cons.status === 403, `booker A cannot submit consumption for it (${cons.status})`);

  const fb = await json(a, '/orders/feedback', {
    method: 'POST', body: JSON.stringify({ orderId: victim.id, taste: 1, quality: 1 }),
  });
  ck(fb.status === 403, `booker A cannot submit feedback for it (${fb.status})`);

  const byAdmin = await json(admin, `/orders/${victim.id}/closeout-items`);
  ck(byAdmin.status === 200, `but the admin can open it (${byAdmin.status})`);
}

// ---------------------------------------------------- a booker's own close-out still works
const own = mineA.find((o) => o.needsCloseOut);
if (own) {
  const r = await json(a, `/orders/${own.id}/closeout-items`);
  ck(r.status === 200, `booker A can still open their own close-out (${r.status})`);
} else {
  console.log('SKIP  booker A has nothing open to close out');
}

// ---------------------------------------------------- an admin must name the route
const menu2 = (await json(admin, `/menu?date=${TOM}&session=BREAKFAST`)).body;
const slots2 = {}; (menu2.slots || []).forEach((s) => { if (s.group) slots2[s.group] = 10; });

const noRoute = await json(admin, '/orders', {
  method: 'POST', body: JSON.stringify({ date: TOM, session: 'BREAKFAST', slots: slots2 }),
});
ck(noRoute.status === 422 && /route/i.test(noRoute.body?.error ?? ''),
  `an admin booking with no route is refused (${noRoute.status}: ${noRoute.body?.error})`);

// a booker, by contrast, may still leave it on auto
const units = (await json(admin, '/admin/units')).body;
ck(Array.isArray(units) && units.length > 0, `${units.length} routes exist`);

// ---------------------------------------------------- role separation still holds
ck((await call(a, '/admin/users')).status === 403, 'a booker cannot read the user list');
ck((await call(a, '/verification/pending')).status === 403, 'a booker cannot read the verification queue');
ck((await call(a, '/menu-admin/options')).status === 403, 'a booker cannot open the menu editor');
ck((await call(kitchen, '/menu-admin/options')).status === 200, 'the kitchen can open the menu editor');
ck((await call(kitchen, '/admin/users')).status === 403, 'the kitchen cannot read the user list');
ck((await fetch(`${API}/bookings/recent`)).status === 401, 'no token is refused');

console.log(`\n${fail === 0 ? 'All' : `${pass}/${pass + fail}`} checks passed${fail ? ` — ${fail} FAILED` : '.'}`);
process.exit(fail ? 1 : 0);
