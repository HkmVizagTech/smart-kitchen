// The per-route delivery note.
//
// The packing sheet is one wide grid covering every route — right for the
// kitchen, useless on a van. This is the same figures cut the other way: one
// slip per route, carrying only what that route receives.
//
//   API=... TEST_PASSWORD=... node test/delivery-notes.test.mjs

const API = process.env.API || 'http://127.0.0.1:4200';
const PASSWORD = process.env.TEST_PASSWORD || 'devpass';
let pass = 0, fail = 0;
const ck = (o, l) => o ? (pass++, console.log('PASS ', l)) : (fail++, console.log('FAIL ', l));

async function login(u) {
  for (let i = 0; i < 8; i++) {
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

const kitchen = await login('kitchen'), booker = await login('booking');
const admin = await login('admin');
const TOM = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const url = `${API}/packing/delivery-notes?date=${TOM}&session=BREAKFAST`;

const call = (t, p, o = {}) => fetch(API + p, { ...o,
  headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(o.headers || {}) } });

// Book a couple of routes, so there is something to print. Seeded here rather
// than assumed: a suite that passes on an empty day proves nothing.
{
  const units = await (await call(admin, '/admin/units')).json();
  const menu = await (await call(booker, `/menu?date=${TOM}&session=BREAKFAST`)).json();
  const slots = {};
  (menu.slots || []).forEach((x) => { if (x.group) slots[x.group] = 60; });
  for (const [who, idx] of [['booking', 0], ['booker2', 1]]) {
    const tok = who === 'booking' ? booker : await login(who);
    await call(tok, '/orders', { method: 'POST',
      body: JSON.stringify({ date: TOM, session: 'BREAKFAST', slots, unitId: units[idx].id }) });
  }
}

const res = await fetch(`${url}&token=${encodeURIComponent(kitchen)}`);
const html = await res.text();
ck(res.status === 200, `the kitchen can open the notes (${res.status})`);
ck(res.headers.get('content-type')?.includes('text/html'), 'served as a printable page, not a download');

const notes = (html.match(/class="note"/g) || []).length;
ck(notes > 0, `one slip per booked route (${notes})`);
ck(html.includes('page-break-after'), 'each slip starts on its own sheet when printed');
ck(/Packed by/i.test(html) && /Received by/i.test(html), 'with somewhere to sign');
ck(/Loaded/i.test(html), 'and a column to tick off as cans go on');

// the route's own total, not the kitchen-wide one
const plates = [...html.matchAll(/<span>(\d+)<\/span>plates/g)].map((m) => Number(m[1]));
ck(plates.length === notes, `every slip states its own plate count (${plates.join(', ')})`);
ck(plates.every((p) => p > 0), 'and none of them is zero');

// cans must be spelled out, not left as a bare number
ck(/× 20 kg|× 15 kg/.test(html), 'weight dishes say how many cans of what size');
ck(/\d+ × \d{2,3}</.test(html) || /\d+ × \d{2,3} /.test(html), 'counted dishes give the can breakdown');

const asBooker = await fetch(`${url}&token=${encodeURIComponent(booker)}`);
ck(asBooker.status === 403, `a booker cannot pull the kitchen's notes (${asBooker.status})`);

const noToken = await fetch(url);
ck(noToken.status === 401, `nor can an anonymous caller (${noToken.status})`);

console.log(`\n${fail === 0 ? 'All' : `${pass}/${pass + fail}`} checks passed${fail ? ` — ${fail} FAILED` : '.'}`);
process.exit(fail ? 1 : 0);
