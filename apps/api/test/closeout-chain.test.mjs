// The close-out chain, end to end, against a running API.
//
// consumption -> verification -> feedback -> next order. Each step is refused
// out of order, a returned close-out reopens at consumption with the previous
// figures, and only feedback closes the order and unlocks the route.
//
//   node test/closeout-chain.test.mjs     (needs the API on :4200 and an open order)

const API = process.env.API_URL || 'http://127.0.0.1:4200';
// Accounts' passwords come from the seed run, so pass the one in use:
//   TEST_PASSWORD=... node test/closeout-chain.test.mjs
const PASSWORD = process.env.TEST_PASSWORD || 'devpass';
let pass = 0, fail = 0;
const ck = (ok, l) => { ok ? (pass++, console.log('PASS ', l)) : (fail++, console.log('FAIL ', l)); };

async function login(u) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${API}/auth/login`, { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ identifier:u, password:PASSWORD }) });
    const d = await r.json().catch(()=>({}));
    if (r.ok && d.token) return d.token;
    if (r.status !== 429) throw new Error(`login ${u}: ${r.status} ${d.error ?? ''}`);
    const w = Number(String(d.error??'').match(/(\d+) second/)?.[1] ?? 10) + 1;
    console.log(`      (rate limited, waiting ${w}s)`);
    await new Promise(res=>setTimeout(res, w*1000));
  }
  throw new Error(`login ${u}: still rate limited`);
}
const call = (tok, path, opts={}) => fetch(API+path, { ...opts,
  headers: { 'content-type':'application/json', authorization:`Bearer ${tok}`, ...(opts.headers||{}) } });

const bk = await login('booking'), vf = await login('verify');

// Book the meal this suite then walks through. Seeded here rather than
// assumed, so the suite cannot quietly pass on an empty database.
const TOM = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
{
  const menu = await (await call(bk, `/menu?date=${TOM}&session=BREAKFAST`)).json();
  const slots = {};
  (menu.slots || []).forEach((x) => { if (x.group) slots[x.group] = 60; });
  await call(bk, '/orders', { method:'POST',
    body: JSON.stringify({ date: TOM, session:'BREAKFAST', slots }) });
}
let r = await (await call(bk, '/bookings/recent')).json();
const order = r.find(o => o.needsCloseOut);
if (!order) { console.log('FAIL  no open order to close out'); process.exit(1); }
console.log('order', order.id, order.unit, order.session);

// 1. can this route book again? no.
let st = await (await call(bk, '/me/booking-status')).json();
ck(st.BREAKFAST.canOrder === false, `tiffin locked (${st.BREAKFAST.blockedBy?.needs.join(', ')})`);
ck(st.BREAKFAST.blockedBy?.needs[0] === 'enter consumption', 'next step is: enter consumption');

// 2. feedback before consumption is refused
let fb = await call(bk, '/orders/feedback', { method:'POST', body: JSON.stringify({ orderId: order.id, taste:5, quality:5 }) });
ck(fb.status === 409, `feedback before consumption refused (${fb.status})`);

// 3. consumption, with no feedback fields at all
const items = (await (await call(bk, `/orders/${order.id}/closeout-items`)).json());
ck(items.stage === 'CONSUMPTION', `stage CONSUMPTION (${items.stage})`);
let c = await call(bk, '/orders/consumption', { method:'POST', body: JSON.stringify({
  orderId: order.id, items: items.items.map(i => ({ dishId:i.dishId, consumed: i.ordered - 10 })), notes:'ten short on each' }) });
ck(c.ok, `consumption accepted without feedback (${c.status})`);

let it2 = await (await call(bk, `/orders/${order.id}/closeout-items`)).json();
ck(it2.stage === 'AWAITING_VERIFICATION', `stage AWAITING_VERIFICATION (${it2.stage})`);

// 4. feedback still refused while pending
fb = await call(bk, '/orders/feedback', { method:'POST', body: JSON.stringify({ orderId: order.id, taste:4, quality:4 }) });
ck(fb.status === 409, `feedback refused while unverified (${fb.status})`);

// 5. verification returns it
let v = await call(vf, '/orders/verify', { method:'POST', body: JSON.stringify({ orderId: order.id, approve:false, reason:'idly count looks low, recheck' }) });
ck(v.ok, 'verification can send it back');
let it3 = await (await call(bk, `/orders/${order.id}/closeout-items`)).json();
ck(it3.stage === 'CONSUMPTION', `returned close-out reopens at CONSUMPTION (${it3.stage})`);
ck(it3.previous?.rejectionReason === 'idly count looks low, recheck', 'the reason comes back with it');
ck(it3.items.every(i => i.consumed !== null), 'previous figures are prefilled');

// 6. resubmit, then approve
c = await call(bk, '/orders/consumption', { method:'POST', body: JSON.stringify({
  orderId: order.id, items: it3.items.map(i => ({ dishId:i.dishId, consumed: i.ordered })) }) });
ck(c.ok, 'corrected consumption accepted');
v = await call(vf, '/orders/verify', { method:'POST', body: JSON.stringify({ orderId: order.id, approve:true }) });
const vj = await v.json();
ck(v.ok, `verification approves (amount ${vj.amount})`);

// 7. still locked — feedback outstanding
st = await (await call(bk, '/me/booking-status')).json();
ck(st.BREAKFAST.canOrder === false, 'still locked after verification');
ck(st.BREAKFAST.blockedBy?.needs[0] === 'give feedback on the food', `next step is feedback (${st.BREAKFAST.blockedBy?.needs[0]})`);
let it4 = await (await call(bk, `/orders/${order.id}/closeout-items`)).json();
ck(it4.stage === 'FEEDBACK', `stage FEEDBACK (${it4.stage})`);

// 8. feedback needs both scores
fb = await call(bk, '/orders/feedback', { method:'POST', body: JSON.stringify({ orderId: order.id, taste:4, quality:0 }) });
ck(fb.status === 422, `half-filled feedback refused (${fb.status})`);

// 9. feedback closes it and unlocks
fb = await call(bk, '/orders/feedback', { method:'POST', body: JSON.stringify({ orderId: order.id, taste:4, quality:3, remarks:'sambar arrived cold' }) });
ck(fb.ok, 'feedback accepted');
st = await (await call(bk, '/me/booking-status')).json();
ck(st.BREAKFAST.canOrder === true, 'tiffin unlocked after feedback');
let it5 = await (await call(bk, `/orders/${order.id}/closeout-items`)).json();
ck(it5.stage === 'DONE', `stage DONE (${it5.stage})`);
r = await (await call(bk, '/bookings/recent')).json();
const done = r.find(o => o.id === order.id);
ck(done.status === 'CLOSED', `order is CLOSED (${done.status})`);
ck(done.needsCloseOut === false, 'no longer needs close-out');

console.log(`\n${fail === 0 ? 'All' : pass+'/'+(pass+fail)} checks passed${fail ? ` — ${fail} FAILED` : '.'}`);
process.exit(fail ? 1 : 0);
