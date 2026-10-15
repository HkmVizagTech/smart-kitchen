// Emergency orders must actually be approved by somebody.
//
// The booking screen always said an emergency order "needs admin approval".
// It did not: the order was placed and the kitchen simply saw it. This pins
// the step that was missing — nothing is cooked, counted or close-out-chased
// on the strength of a request nobody has agreed to.
//
//   API=... TEST_PASSWORD=... node test/emergency.test.mjs

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

const bk = await login('booking'), admin = await login('admin'), kitchen = await login('kitchen');
const TODAY = new Date().toISOString().slice(0, 10);
const units = (await json(admin, '/admin/units')).body;

// ------------------------------------------------ placed, but not yet agreed
const placed = await json(bk, '/orders', { method: 'POST', body: JSON.stringify({
  date: TODAY, session: 'LUNCH', isEmergency: true, peopleCount: 40, unitId: units[0].id }) });
ck(placed.status === 200, `an emergency order can be placed (${placed.status})`);
const id = placed.body?.id;
ck(placed.body?.approval === 'PENDING', `and starts as PENDING (${placed.body?.approval})`);

const queue = (await json(admin, '/orders/emergency/pending')).body;
ck(queue.some((r) => r.id === id), 'it appears in the admin queue');
ck(queue.find((r) => r.id === id)?.requestedBy, 'naming who asked for it');

let kOrders = (await json(kitchen, `/orders?date=${TODAY}&session=LUNCH`)).body;
ck(!kOrders.some((o) => o.id === id), 'the kitchen does NOT see it yet');

const bkList = (await json(bk, '/bookings/recent')).body;
const row = bkList.find((o) => o.id === id);
ck(row?.approval === 'PENDING', 'the route sees it waiting');
ck(row?.needsCloseOut === false, 'and is not asked to close out something not yet agreed');

// ------------------------------------------------ declining needs a reason
const noReason = await json(admin, `/orders/${id}/approval`, {
  method: 'POST', body: JSON.stringify({ approve: false }) });
ck(noReason.status === 422, `declining without a reason is refused (${noReason.status})`);

const asBooker = await json(bk, `/orders/${id}/approval`, {
  method: 'POST', body: JSON.stringify({ approve: true }) });
ck(asBooker.status === 403, `a booker cannot approve their own (${asBooker.status})`);

// ------------------------------------------------ approve it
const ok = await json(admin, `/orders/${id}/approval`, {
  method: 'POST', body: JSON.stringify({ approve: true }) });
ck(ok.status === 200 && ok.body?.approval === 'APPROVED', `the admin approves it (${ok.status})`);

kOrders = (await json(kitchen, `/orders?date=${TODAY}&session=LUNCH`)).body;
ck(kOrders.some((o) => o.id === id), 'now the kitchen sees it');

const again = await json(admin, `/orders/${id}/approval`, {
  method: 'POST', body: JSON.stringify({ approve: false, reason: 'changed my mind' }) });
ck(again.status === 409, `it cannot be decided twice (${again.status})`);

// ------------------------------------------------ declining
const second = await json(bk, '/orders', { method: 'POST', body: JSON.stringify({
  date: TODAY, session: 'LUNCH', isEmergency: true, peopleCount: 25, unitId: units[1].id }) });
const id2 = second.body?.id;
ck(second.status === 200, `a second emergency order is placed (${second.status})`);

const dec = await json(admin, `/orders/${id2}/approval`, {
  method: 'POST', body: JSON.stringify({ approve: false, reason: 'too late to cook for today' }) });
ck(dec.status === 200, `the admin declines it (${dec.status})`);

kOrders = (await json(kitchen, `/orders?date=${TODAY}&session=LUNCH`)).body;
ck(!kOrders.some((o) => o.id === id2), 'a declined order never reaches the kitchen');

const after = (await json(bk, '/bookings/recent')).body.find((o) => o.id === id2);
ck(after?.approval === 'DECLINED', 'the route sees it was declined');
ck(after?.declineReason === 'too late to cook for today', 'with the reason');
ck(after?.needsCloseOut === false, 'and is not chased to close out a meal that never happened');

// ------------------------------------------------ a normal order is unaffected
const normalRow = (await json(bk, '/bookings/recent')).body.find((o) => !o.isEmergency);
if (normalRow) ck(normalRow.approval === null, 'a normal order carries no approval at all');
else console.log('SKIP  no normal order present to compare');

console.log(`\n${fail === 0 ? 'All' : `${pass}/${pass + fail}`} checks passed${fail ? ` — ${fail} FAILED` : '.'}`);
process.exit(fail ? 1 : 0);
