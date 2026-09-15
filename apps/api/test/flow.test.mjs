// End-to-end test of the ordering loop against a real Postgres + API.
//
// Covers the parts nobody had exercised: route selection (auto vs. chosen),
// the reorder gate, and the full booking -> kitchen -> close-out -> verify
// cycle, plus role separation on the routes each step uses.
//
// The test books every route for tomorrow, so it needs a database with no
// orders for that date. Reset one with:
//   psql "$DATABASE_URL" -c 'TRUNCATE "Order","OrderItem","Consumption","ConsumptionItem","Feedback","Notification" RESTART IDENTITY CASCADE;'
//
// Usage:
//   API=http://127.0.0.1:4200 node flow.test.mjs

const API = process.env.API ?? "http://127.0.0.1:4200";

let pass = 0, fail = 0;
function check(ok, label, detail = "") {
  if (ok) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ""}`); }
}

async function call(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

// The API evaluates order windows in Asia/Kolkata, so build dates the same way.
const istYmd = (offsetDays = 0) => {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
};
const TOMORROW = istYmd(1);

const login = async (u) => (await call("/auth/login", { method: "POST", body: { identifier: u, password: "testpass123" } })).data.token;

console.log(`\n--- signing in ---`);
const booking = await login("booking");
const kitchen = await login("kitchen");
const verifier = await login("verify");
const admin = await login("admin");
check(!!booking && !!kitchen && !!verifier && !!admin, "all four roles can sign in");

// Real deployments have one booker per route, and the API allows each booker
// only one order per meal per day — so filling several routes needs several
// bookers. Create them idempotently (409 = already there from a previous run).
const bookers = [booking];
for (let i = 2; i <= 6; i++) {
  const username = `booker${i}`;
  await call("/admin/users", {
    method: "POST", token: admin,
    body: { role: "BOOKING", username, password: "testpass123", name: `Booker ${i}` },
  });
  bookers.push(await login(username));
}
check(bookers.every(Boolean) && bookers.length === 6, "six booking accounts are available");

// Fail fast and clearly if a previous run left tomorrow's routes booked,
// rather than emitting a cascade of confusing failures.
{
  const pre = (await call(`/booking/progress?date=${TOMORROW}&session=BREAKFAST`, { token: admin })).data;
  if (pre?.booked > 0) {
    console.log(`\nSTOP  ${pre.booked}/${pre.total} routes are already booked for ${TOMORROW}.`);
    console.log(`      This test needs a clean slate. Truncate the order tables and re-run`);
    console.log(`      (see the note at the top of this file).`);
    process.exit(2);
  }
}

console.log(`\n--- role separation ---`);
check((await call("/admin/users", { token: bookers[0] })).status === 403, "booking token is refused on /admin/users");
check((await call("/verification/pending", { token: bookers[0] })).status === 403, "booking token is refused on /verification/pending");
check((await call("/admin/users", { token: admin })).status === 200, "admin token is accepted on /admin/users");
check((await call("/admin/users")).status === 401, "no token is refused");

console.log(`\n--- route selection (tiffin for ${TOMORROW}) ---`);
const menu = (await call("/booking-menu", { token: bookers[0] })).data;
const idly = menu.ITEM1.find((d) => !d.accompaniment);
const wada = menu.ITEM3.find((d) => !d.accompaniment);
check(!!idly && !!wada, "booking menu returns bookable dishes");

const order = (token, extra = {}) => call("/orders", {
  method: "POST", token,
  body: { date: TOMORROW, session: "BREAKFAST", items: [{ dishId: idly.id, plates: 100 }, { dishId: wada.id, plates: 50 }], ...extra },
});

const units = (await call("/admin/units", { token: admin })).data;
const unit4 = units.find((u) => u.name === "Unit-4");

// 1. no unitId -> auto-assign the first free route
const auto = await order(bookers[0]);
check(auto.status === 200 && auto.data.assignedUnit === "Unit-1",
  `auto-assign picks the first free route (got ${auto.data?.assignedUnit})`, JSON.stringify(auto.data).slice(0, 140));

// 2. a different booker names a route -> honoured
const chosen = await order(bookers[1], { unitId: unit4.id });
check(chosen.status === 200 && chosen.data.assignedUnit === "Unit-4",
  `a chosen route is honoured (got ${chosen.data?.assignedUnit})`, JSON.stringify(chosen.data).slice(0, 140));

// 3. that route is now taken -> refused with a clear message
const dup = await order(bookers[2], { unitId: unit4.id });
check(dup.status === 409 && /already booked/i.test(dup.data?.error ?? ""),
  "a route already taken is refused", JSON.stringify(dup.data));

// 4. route that does not exist -> refused
const ghost = await order(bookers[2], { unitId: 9999 });
check(ghost.status === 422, "unknown route is refused", JSON.stringify(ghost.data));

// 5. auto-assign skips the taken ones
const auto2 = await order(bookers[2]);
check(auto2.status === 200 && auto2.data.assignedUnit === "Unit-2",
  `auto-assign skips taken routes (got ${auto2.data?.assignedUnit})`);

// 6. one order per booker per meal per day — on auto AND on a named route
const again = await order(bookers[0]);
check(again.status === 409 && /already booked/i.test(again.data?.error ?? ""),
  "the same booker cannot book the same meal twice in a day", JSON.stringify(again.data));
const freeRoute = units.find((u) => !["Unit-1", "Unit-2", "Unit-4"].includes(u.name));
const againNamed = await order(bookers[0], { unitId: freeRoute.id });
check(againNamed.status === 409,
  "naming a free route does not bypass the per-booker limit", JSON.stringify(againNamed.data));


console.log(`\n--- order window rules ---`);
const todayTiffin = await order(bookers[3], { date: istYmd(0) });
check(todayTiffin.status === 422, "tiffin for today is refused (today-for-tomorrow only)");
const farTiffin = await order(bookers[3], { date: istYmd(3) });
check(farTiffin.status === 422, "tiffin three days out is refused");

console.log(`\n--- kitchen moves the order ---`);
const orderId = auto.data.id;
check((await call(`/orders/${orderId}/status`, { method: "POST", token: bookers[0], body: { status: "PREPARING" } })).status === 403,
  "a booker cannot change order status");
for (const status of ["PREPARING", "DISPATCHED", "DELIVERED"]) {
  const r = await call(`/orders/${orderId}/status`, { method: "POST", token: kitchen, body: { status } });
  check(r.status === 200 && r.data.status === status, `kitchen sets status ${status}`);
}

console.log(`\n--- reorder gate ---`);
const gate1 = (await call(`/units/${auto.data.unitId}/can-order`, { token: bookers[0] })).data;
check(gate1.canOrder === false, `route is locked until close-out (reason: ${gate1.reason})`);

console.log(`\n--- close-out + feedback ---`);
const items = (await call(`/orders/${orderId}/closeout-items`, { token: bookers[0] })).data;
check(items.items.length > 0, "close-out lists the main items only");
const closeout = await call("/orders/consumption", {
  method: "POST", token: bookers[0],
  body: {
    orderId,
    items: items.items.map((i) => ({ dishId: i.dishId, consumed: Math.max(0, i.ordered - 10) })),
    notes: "test run", taste: 4, quality: 5,
  },
});
check(closeout.status === 200, "close-out with feedback is accepted", JSON.stringify(closeout.data));

const noFeedback = await call("/orders/consumption", {
  method: "POST", token: bookers[0],
  body: { orderId, items: [], taste: 0, quality: 0 },
});
check(noFeedback.status === 422, "close-out without feedback is refused");

console.log(`\n--- verification ---`);
const pending = (await call("/verification/pending", { token: verifier })).data;
const mine = pending.find((p) => p.orderId === orderId);
check(!!mine, "the close-out appears in the verification queue");
check(mine?.leftover === 20, `leftover is computed (expected 20, got ${mine?.leftover})`);
check(mine?.taste === 4 && mine?.quality === 5, "feedback is carried through to verification");

check((await call("/orders/verify", { method: "POST", token: bookers[0], body: { orderId, approve: true } })).status === 403,
  "a booker cannot verify their own order");

const approved = await call("/orders/verify", { method: "POST", token: verifier, body: { orderId, approve: true } });
check(approved.status === 200, "verifier approves the close-out");

const gate2 = (await call(`/units/${auto.data.unitId}/can-order`, { token: bookers[0] })).data;
check(gate2.canOrder === true, `route unlocks after verification (reason: ${gate2.reason})`);

console.log(`\n--- packing sheet gate ---`);
const early = await call(`/packing/preview?date=${TOMORROW}&session=BREAKFAST`, { token: kitchen });
check(early.status === 200 && early.data.ready === false,
  `packing sheet is withheld until all routes book (${early.data?.booked}/${early.data?.total})`);

// Fill the remaining routes — one booker each, matching how this works in real
// use. bookers[0..2] have already booked tiffin, so start from bookers[3].
{
  let next = 3;
  for (const u of units) {
    const taken = (await call(`/booking/progress?date=${TOMORROW}&session=BREAKFAST`, { token: bookers[0] })).data;
    if (taken.units.find((x) => x.id === u.id)?.booked) continue;
    const r = await order(bookers[next], { unitId: u.id });
    if (r.status !== 200) console.log(`      (could not fill ${u.name}: ${JSON.stringify(r.data)})`);
    next++;
  }
}
const ready = await call(`/packing/preview?date=${TOMORROW}&session=BREAKFAST`, { token: kitchen });
check(ready.data?.ready === true, `packing sheet opens once all routes are booked (${ready.data?.booked}/${ready.data?.total})`);
check(ready.data?.sheet?.rows?.length === units.length, `sheet has a row per route (${ready.data?.sheet?.rows?.length})`);

const sheetRow = ready.data?.sheet?.rows?.[0];
check(!!sheetRow && Object.keys(sheetRow.cells).length > 0, "sheet rows carry computed quantities");

const excel = await fetch(`${API}/packing/excel?date=${TOMORROW}&token=${encodeURIComponent(kitchen)}`);
const buf = Buffer.from(await excel.arrayBuffer());
check(excel.status === 200 && buf.length > 1000 && buf.subarray(0, 2).toString() === "PK",
  `Excel downloads via ?token= and is a real xlsx (${buf.length} bytes)`);

const excelAsBooker = await fetch(`${API}/packing/excel?date=${TOMORROW}&token=${encodeURIComponent(bookers[0])}`);
check(excelAsBooker.status === 403, "a booker cannot download the packing sheet");

console.log(`\n--- a booker may still book a different meal the same day ---`);
const dinnerSameBooker = await call("/orders", {
  method: "POST", token: bookers[0],
  body: { date: TOMORROW, session: "DINNER", items: [{ dishId: idly.id, plates: 20 }] },
});
check(dinnerSameBooker.status === 200, "the same booker may still book a different meal",
  JSON.stringify(dinnerSameBooker.data).slice(0, 120));

console.log(`\n--- KNOWN GAP: the reorder gate is advisory, not enforced ---`);
// /units/:id/can-order reports whether a route is clear to book again, and the
// booking UI reads it — but POST /orders never consults it. So the "mandatory
// loop" the system is built around can be walked straight past by any client
// that simply does not ask. Documented here so the behaviour is visible; see
// the note in the project docs before changing it.
{
  // Unit-2 has an open tiffin order that was never closed out.
  const unitId = auto2.data.unitId;
  const gate = (await call(`/units/${unitId}/can-order`, { token: bookers[0] })).data;
  check(gate.canOrder === false, `gate reports Unit-2 as locked (${gate.reason})`);

  // A booker who has not yet booked dinner places one on that same locked route.
  // Window rules and the per-booker rule both allow it; only the reorder gate
  // should stop it — and it does not, because POST /orders never asks.
  const sneak = await call("/orders", {
    method: "POST", token: bookers[5],
    body: { date: TOMORROW, session: "DINNER", items: [{ dishId: idly.id, plates: 5 }], unitId },
  });
  check(sneak.status === 200,
    `the API still accepts a new order for that locked route (status ${sneak.status}) — gate NOT enforced`,
    JSON.stringify(sneak.data).slice(0, 140));
}

console.log(`\n${fail === 0 ? "All" : `${pass}/${pass + fail}`} checks passed${fail ? ` — ${fail} FAILED` : "."}`);
process.exit(fail ? 1 : 0);
