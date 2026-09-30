// The generated delivery sheet, checked against the kitchen's own printout.
//
// Feeds the real indents from "Brandix Packing Sheet 28th Apr 2026" through
// the menu and the packing engine, and compares every cooked quantity and can
// count with what the spreadsheet prints.
//
// Four cells differ, and in all four the spreadsheet is wrong — they are
// listed below with the arithmetic. Someone fills this in by hand every
// morning, which is the whole argument for generating it.
//
//   DATABASE_URL=... npx tsx test/packing-vs-sheet.test.ts

import { prisma } from "@sk/db";
import { expandSlots } from "../src/menu.js";
import { computeSession } from "../src/packingService.js";

const D = new Date("2026-04-28T00:00:00.000Z");

const INDENT = {
  BREAKFAST: [["Unit-1",150,450,150],["Unit-2",250,650,200],["Unit-3",250,650,180],
              ["Unit-4",150,450,150],["Visakha",10,16,20],["Others",10,13,30]],
  DINNER:    [["Unit-1",80,420,50],["Unit-2",125,676,125],["Unit-3",200,620,130],
              ["Unit-4",200,350,100],["Visakha",0,34,0]],
} as Record<string, [string, number, number, number][]>;

/** What the sheet prints: [Idly pcs, Sambar kg, Chutney kg, Biryani kg, Kurma kg, Wada pcs]. */
const SHEET: Record<string, Record<string, number[]>> = {
  BREAKFAST: {
    "Unit-1": [600,18,24,135,54,600], "Unit-2": [1000,27,36,195,78,800],
    "Unit-3": [1000,25.8,34.4,195,78,720], "Unit-4": [600,18,24,135,54,600],
    "Visakha": [40,1.8,2.4,4.8,1.92,80],
    // Sheet prints 4.095 kg biryani: 13 x 300 g is 3.9, and 4.095 is that x 1.05.
    "Others": [40,2.4,3.2,3.9,1.56,120],
  },
  DINNER: {
    "Unit-1": [320,7.8,10.4,126,50.4,200], "Unit-2": [500,15,20,202.8,81.12,500],
    "Unit-3": [800,19.8,26.4,186,74.4,520], "Unit-4": [800,18,24,105,42,400],
    // Sheet prints 10.71 kg biryani: 34 x 300 g is 10.2, again x 1.05.
    "Visakha": [0,0,0,10.2,4.08,0],
  },
};

/** Can fills the sheet prints, where it printed them correctly. */
const CANS: Record<string, Record<string, Record<string, Record<number, number>>>> = {
  BREAKFAST: {
    "Unit-1": { Idly: {200:3}, Wada: {200:3} },
    "Unit-2": { Idly: {200:5}, Wada: {200:4} },
    // Sheet allocates 1,000 idlys as 4x200 + 1x80 = 880. Ours is 5x200.
    "Unit-3": { Wada: {200:3,120:1} },
    "Unit-4": { Idly: {200:3}, Wada: {200:3} },
  },
  DINNER: {
    "Unit-1": { Idly: {200:1,120:1}, Wada: {200:1} },
    "Unit-2": { Idly: {200:2,100:1}, Wada: {200:2,100:1} },
    // Sheet: Unit-3 800 idlys as 3x200 = 600; Unit-4 800 as 1x200+1x120 = 320,
    // and 400 wada as 1x200. All three short.
    "Unit-3": { Wada: {200:2,120:1} },
  },
};

const NAMES = ["Idly","Sambar","FG Chutney","Biryani","Kurma","Wada"];
let pass = 0, fail = 0;
const check = (ok: boolean, label: string) => {
  if (ok) { pass++; console.log(`PASS  ${label}`); } else { fail++; console.log(`FAIL  ${label}`); }
};

const booker = await prisma.user.findFirst({ where: { role: "BOOKING" } });
await prisma.orderItem.deleteMany({ where: { order: { date: D } } });
await prisma.order.deleteMany({ where: { date: D } });

for (const session of ["BREAKFAST", "DINNER"] as const) {
  for (const [name, i1, i2, i3] of INDENT[session]) {
    if (i1 + i2 + i3 === 0) continue;
    const unit = await prisma.unit.findUnique({ where: { name } });
    const { items, totalPlates } = await expandSlots(D, session, { ITEM1: i1, ITEM2: i2, ITEM3: i3 });
    await prisma.order.create({
      data: { unitId: unit!.id, bookedById: booker!.id, date: D, session, totalPlates,
              items: { create: items.map((i) => ({ dishId: i.dishId, plates: i.plates })) } },
    });
  }

  const s = (await computeSession(D, session))!;
  const label = session === "BREAKFAST" ? "morning" : "evening";

  check(s.indentDishes.map((d) => d.name).join(",") === "Idly,Biryani,Wada",
    `${label}: indent columns are Idly / Biryani / Wada`);
  check(s.dishOrder.map((d) => d.name).join(",") === NAMES.join(","),
    `${label}: quantity columns match the sheet's order`);
  check(s.vessels.join("/") === (session === "BREAKFAST" ? "200/160/120/80/40" : "200/160/120/100/40"),
    `${label}: can sizes are right (${s.vessels.join("/")})`);

  for (const row of s.rows) {
    const want = SHEET[session][row.unit];
    if (!want) continue;
    const got = NAMES.map((n) => row.cells[n]?.qty ?? 0);
    const wrong = got.map((g, k) => (Math.abs(g - want[k]) > 0.01 ? `${NAMES[k]} ${g}!=${want[k]}` : null)).filter(Boolean);
    check(wrong.length === 0, `${label} ${row.unit}: quantities${wrong.length ? ` — ${wrong.join("; ")}` : ""}`);

    const cans = CANS[session][row.unit];
    if (cans) {
      const bad = Object.entries(cans).filter(([dish, want]) => {
        const got = row.cells[dish]?.vessels ?? {};
        return Object.entries(want).some(([size, n]) => (got[Number(size)] ?? 0) !== n);
      });
      check(bad.length === 0, `${label} ${row.unit}: can fills${bad.length ? ` — ${bad.map(([d]) => d).join(", ")}` : ""}`);
    }
  }
}

console.log(`\n${fail === 0 ? "All" : `${pass}/${pass + fail}`} checks passed${fail ? ` — ${fail} FAILED` : "."}`);
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
