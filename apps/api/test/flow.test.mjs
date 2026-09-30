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
//
// Set DATABASE_URL as well to include the per-booker reorder gate checks. They
// need psql because the gate only bites ACROSS dates (a second order for the
// same date is stopped earlier, by the one-per-booker-per-day rule), so the
// test backdates an open order to reach it in a single run.

const API = process.env.API ?? "http://127.0.0.1:4200";
// The seed generates a random password per account and prints it once, so the
// password the four starter roles actually have is whatever that run produced.
// Pass it in: TEST_PASSWORD=... node test/flow.test.mjs
const PASSWORD = process.env.TEST_PASSWORD ?? "testpass123";

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

const login = async (u) => (await call("/auth/login", { method: "POST", body: { identifier: u, password: PASSWORD } })).data.token;

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
    body: { role: "BOOKING", username, password: PASSWORD, name: `Booker ${i}` },
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
// Bookers no longer pick dishes. The kitchen's menu says what Item 1/2/3 are
// for that day, and the booker sends three plate counts against them.
const menu = (await call(`/menu?date=${TOMORROW}&session=BREAKFAST`, { token: bookers[0] })).data;
check(menu.slots.length === 3 && menu.slots.every((s) => s.group),
  `the day's tiffin menu has three bookable items (${menu.slots.map((s) => s.dish.name).join(", ")})`);
check(menu.slots.some((s) => s.accompaniments.length > 0),
  "accompaniments hang off the items rather than being ordered");

const SLOTS = { ITEM1: 100, ITEM2: 0, ITEM3: 50 };
const order = (token, extra = {}) => call("/orders", {
  method: "POST", token,
  body: { date: TOMORROW, session: "BREAKFAST", slots: SLOTS, ...extra },
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

console.log(`\n--- close-out: consumption, then verification, then feedback ---`);
// Three steps, in that order. The kitchen wants the plate counts checked before
// anyone reads what was thought of the food, so feedback is refused until the
// consumption it belongs to has been approved.
const items = (await call(`/orders/${orderId}/closeout-items`, { token: bookers[0] })).data;
check(items.items.length > 0, "close-out lists the main items only");
check(items.stage === "CONSUMPTION", `it opens at step one (${items.stage})`);

const tooEarly = await call("/orders/feedback", {
  method: "POST", token: bookers[0], body: { orderId, taste: 5, quality: 5 },
});
check(tooEarly.status === 409, "feedback before any consumption is refused");

const closeout = await call("/orders/consumption", {
  method: "POST", token: bookers[0],
  body: {
    orderId,
    items: items.items.map((i) => ({ dishId: i.dishId, consumed: Math.max(0, i.ordered - 10) })),
    notes: "test run",
  },
});
check(closeout.status === 200, "consumption alone is accepted", JSON.stringify(closeout.data));
check((await call(`/orders/${orderId}/closeout-items`, { token: bookers[0] })).data.stage === "AWAITING_VERIFICATION",
  "the close-out moves to step two");

const stillEarly = await call("/orders/feedback", {
  method: "POST", token: bookers[0], body: { orderId, taste: 5, quality: 5 },
});
check(stillEarly.status === 409, "feedback is still refused while verification is pending");

console.log(`\n--- verification ---`);
const pending = (await call("/verification/pending", { token: verifier })).data;
const mine = pending.find((p) => p.orderId === orderId);
check(!!mine, "the close-out appears in the verification queue");
check(mine?.leftover === 20, `leftover is computed (expected 20, got ${mine?.leftover})`);

check((await call("/orders/verify", { method: "POST", token: bookers[0], body: { orderId, approve: true } })).status === 403,
  "a booker cannot verify their own order");

const noReason = await call("/orders/verify", { method: "POST", token: verifier, body: { orderId, approve: false } });
check(noReason.status === 422, "sending a close-out back without a reason is refused");

const approved = await call("/orders/verify", { method: "POST", token: verifier, body: { orderId, approve: true } });
check(approved.status === 200, "verifier approves the figures");

const gateMid = (await call(`/units/${auto.data.unitId}/can-order`, { token: bookers[0] })).data;
check(gateMid.canOrder === false, `approval alone does not unlock — feedback is still owed (${gateMid.reason})`);
check((await call(`/orders/${orderId}/closeout-items`, { token: bookers[0] })).data.stage === "FEEDBACK",
  "the feedback step is now open");

console.log(`\n--- feedback closes the loop ---`);
const halfRated = await call("/orders/feedback", {
  method: "POST", token: bookers[0], body: { orderId, taste: 4, quality: 0 },
});
check(halfRated.status === 422, "feedback needs both scores");

const feedback = await call("/orders/feedback", {
  method: "POST", token: bookers[0], body: { orderId, taste: 4, quality: 5, remarks: "test run" },
});
check(feedback.status === 200, "feedback is accepted once verified", JSON.stringify(feedback.data));

const gate2 = (await call(`/units/${auto.data.unitId}/can-order`, { token: bookers[0] })).data;
check(gate2.canOrder === true, `the route unlocks only after feedback (reason: ${gate2.reason})`);
check(gate2.order?.status === "CLOSED" || gate2.order === null, "and the order is closed");

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
  body: { date: TOMORROW, session: "DINNER", slots: { ITEM1: 20 } },
});
check(dinnerSameBooker.status === 200, "the same booker may still book a different meal",
  JSON.stringify(dinnerSameBooker.data).slice(0, 120));

console.log(`\n--- the per-booker reorder gate ---`);
// A booker's FIRST order of a meal is free. Every one after that requires the
// previous order in that same meal to be closed out — consumption AND feedback.
// It is enforced in POST /orders, not merely reported, and /me/booking-status
// exposes the same answer so the UI can say so before a form is filled.
//
// Note there are two different gates in this system and they are not the same:
//   /units/:id/can-order   per ROUTE,  still advisory — the kitchen's view
//   /me/booking-status     per BOOKER, enforced      — the rule below
{
  await call("/admin/users", {
    method: "POST", token: admin,
    body: { role: "BOOKING", username: "gatetest", password: PASSWORD, name: "Gate Test" },
  });
  const gb = await login("gatetest");

  const before = (await call("/me/booking-status", { token: gb })).data;
  check(before?.DINNER?.canOrder === true, "a booker with no history may place a first order");

  const first = await call("/orders", {
    method: "POST", token: gb,
    body: { date: TOMORROW, session: "DINNER", slots: { ITEM1: 30 } },
  });
  check(first.status === 200, "the first dinner order is accepted", JSON.stringify(first.data).slice(0, 140));

  const held = (await call("/me/booking-status", { token: gb })).data;
  check(held?.DINNER?.canOrder === false, "dinner is now held pending close-out");
  check(
    held?.DINNER?.blockedBy?.needs?.[0] === "enter consumption",
    `the hold names the ONE next step, not a list (${JSON.stringify(held?.DINNER?.blockedBy?.needs)})`
  );
  check(held?.DINNER?.blockedBy?.orderId === first.data.id, "the hold points at the order to close out");

  // Per MEAL, not across meals: tiffin and dinner are separate chains. A shared
  // gate would deadlock — you cannot close out tonight's dinner before the
  // cutoff for tomorrow's tiffin.
  check(held?.BREAKFAST?.canOrder === true, "a different meal is unaffected by the hold");

  // Enforcement in POST /orders only becomes reachable across DATES: a second
  // order for the SAME date is stopped earlier, by the one-per-booker-per-day
  // rule. Backdate the open order to make the realistic case — "yesterday's
  // dinner was never closed out, now book tomorrow's" — testable in one run.
  if (process.env.DATABASE_URL) {
    const { execFileSync } = await import("node:child_process");
    const sql = (q) =>
      execFileSync("psql", [process.env.DATABASE_URL, "-qAt", "-c", q], { encoding: "utf8" }).trim();

    sql(`UPDATE "Order" SET date = date - interval '2 days' WHERE id = ${first.data.id}`);

    const blocked = await call("/orders", {
      method: "POST", token: gb,
      body: { date: TOMORROW, session: "DINNER", slots: { ITEM1: 30 } },
    });
    check(blocked.status === 409, `a second dinner order is refused while the first is open (got ${blocked.status})`,
      JSON.stringify(blocked.data).slice(0, 160));
    check(/close out your previous/i.test(blocked.data?.error ?? ""),
      "the refusal tells the booker what to do", JSON.stringify(blocked.data?.error));
    check(blocked.data?.blockedBy?.orderId === first.data.id,
      "the refusal identifies the order that must be closed out");

    // Consumption alone no longer clears the hold: it has to be verified, and
    // then the booker has to give feedback. Walk all three and check the hold
    // is still on after each of the first two.
    const items = (await call(`/orders/${first.data.id}/closeout-items`, { token: gb })).data;
    const submitted = await call("/orders/consumption", {
      method: "POST", token: gb,
      body: {
        orderId: first.data.id,
        items: items.items.map((i) => ({ dishId: i.dishId, consumed: i.ordered })),
      },
    });
    check(submitted.status === 200, "the booker submits consumption", JSON.stringify(submitted.data).slice(0, 120));

    const midway = (await call("/me/booking-status", { token: gb })).data;
    check(midway?.DINNER?.canOrder === false, "consumption alone does not release the hold");
    check(midway?.DINNER?.blockedBy?.needs?.[0] === "wait for verification",
      `the hold now points at the verifier (${JSON.stringify(midway?.DINNER?.blockedBy?.needs)})`);

    // Sent back once, to prove a returned close-out reopens rather than
    // vanishing — the bug that once made a rejected close-out unreachable.
    await call("/orders/verify", {
      method: "POST", token: verifier,
      body: { orderId: first.data.id, approve: false, reason: "recount the wada" },
    });
    const returned = (await call(`/orders/${first.data.id}/closeout-items`, { token: gb })).data;
    check(returned.stage === "CONSUMPTION", "a returned close-out reopens at consumption");
    check(returned.previous?.rejectionReason === "recount the wada", "with the reason attached");
    check(returned.items.every((i) => i.consumed !== null), "and the previous figures still filled in");

    await call("/orders/consumption", {
      method: "POST", token: gb,
      body: {
        orderId: first.data.id,
        items: returned.items.map((i) => ({ dishId: i.dishId, consumed: i.ordered })),
      },
    });
    await call("/orders/verify", { method: "POST", token: verifier, body: { orderId: first.data.id, approve: true } });

    const verified = (await call("/me/booking-status", { token: gb })).data;
    check(verified?.DINNER?.canOrder === false, "verification alone does not release the hold either");
    check(verified?.DINNER?.blockedBy?.needs?.[0] === "give feedback on the food",
      `the hold now points at feedback (${JSON.stringify(verified?.DINNER?.blockedBy?.needs)})`);

    const closed = await call("/orders/feedback", {
      method: "POST", token: gb, body: { orderId: first.data.id, taste: 5, quality: 5 },
    });
    check(closed.status === 200, "the booker gives feedback", JSON.stringify(closed.data).slice(0, 120));

    const cleared = (await call("/me/booking-status", { token: gb })).data;
    check(cleared?.DINNER?.canOrder === true, "the full chain releases the hold");

    const second = await call("/orders", {
      method: "POST", token: gb,
      body: { date: TOMORROW, session: "DINNER", slots: { ITEM1: 30 } },
    });
    check(second.status === 200, "the next dinner order is accepted once the loop is complete",
      JSON.stringify(second.data).slice(0, 140));

    // That new order re-arms the gate. Backdated further than the first one:
    // a route holds at most one order per date+session, and freeing tomorrow's
    // slot means the new order landed on the same route the first one used.
    sql(`UPDATE "Order" SET date = date - interval '5 days' WHERE id = ${second.data.id}`);
    const blockedAgain = await call("/orders", {
      method: "POST", token: gb,
      body: { date: TOMORROW, session: "DINNER", slots: { ITEM1: 30 } },
    });
    check(blockedAgain.status === 409, "the gate re-arms for every order, not just the second");

    // ...but an emergency order is exempt by definition: it is the escape hatch
    // for the day something goes wrong, which is exactly when a booker is most
    // likely to be mid-loop.
    const emergency = await call("/orders", {
      method: "POST", token: gb,
      body: { date: TOMORROW, session: "DINNER", peopleCount: 40, isEmergency: true },
    });
    check(emergency.status === 200, "an emergency order is exempt from the gate",
      JSON.stringify(emergency.data).slice(0, 140));

    // ...and an emergency order does not itself become a blocker.
    const afterEmergency = (await call("/me/booking-status", { token: gb })).data;
    check(afterEmergency?.DINNER?.blockedBy?.orderId === blockedAgain.data?.blockedBy?.orderId,
      "an emergency order does not become the thing blocking the next booking");
  } else {
    console.log("SKIP  cross-date gate enforcement (set DATABASE_URL to run it)");
  }
}

console.log(`\n${fail === 0 ? "All" : `${pass}/${pass + fail}`} checks passed${fail ? ` — ${fail} FAILED` : "."}`);
process.exit(fail ? 1 : 0);
