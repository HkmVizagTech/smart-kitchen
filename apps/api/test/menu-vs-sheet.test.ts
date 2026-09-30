// Pins the packing maths to the kitchen's own spreadsheet.
//
// Every factor in the seed was reverse-engineered from "Brandix Packing Sheet
// 28th Apr 2026" — a Tuesday. This feeds that day's real indent figures back
// through the menu and checks the cooked quantities come out the same, so a
// well-meaning edit to a packing factor cannot silently change how much food
// the kitchen makes.
//
//   DATABASE_URL=... npx tsx test/menu-vs-sheet.test.ts

import { prisma } from "@sk/db";
import { expandSlots, menuFor } from "../src/menu.js";

const D = new Date("2026-04-28T00:00:00.000Z");

/** Indent columns D/E/F, per route. */
const INDENT: [string, number, number, number][] = [
  ["Unit-1", 150, 450, 150],
  ["Unit-2", 250, 650, 200],
  ["Unit-3", 250, 650, 180],
  ["Unit-4", 150, 450, 150],
  ["Visakha", 10, 16, 20],
  ["Others", 10, 13, 30],
];

/** Cooked quantities as printed: Idly pcs, Sambar kg, Chutney kg, Biryani kg,
 *  Kurma kg, Wada pcs. */
const SHEET: Record<string, number[]> = {
  "Unit-1": [600, 18, 24, 135, 54, 600],
  "Unit-2": [1000, 27, 36, 195, 78, 800],
  "Unit-3": [1000, 25.8, 34.4, 195, 78, 720],
  "Unit-4": [600, 18, 24, 135, 54, 600],
  "Visakha": [40, 1.8, 2.4, 4.8, 1.92, 80],
  // Biryani reads 4.095 on the sheet. 13 plates x 300 g is 3.9; 4.095 is
  // exactly 5% more, and every other cell on this row is right, so it is a
  // stray edit in the spreadsheet rather than a rule. We keep the rule.
  "Others": [40, 2.4, 3.2, 3.9, 1.56, 120],
};

const NAMES = ["Idly", "Sambar", "FG Chutney", "Biryani", "Kurma", "Wada"];
const round = (n: number) => Math.round(n * 1000) / 1000;

let pass = 0, fail = 0;
const check = (ok: boolean, label: string) => {
  if (ok) { pass++; console.log(`PASS  ${label}`); } else { fail++; console.log(`FAIL  ${label}`); }
};

const slots = await menuFor(D, "BREAKFAST");
check(
  slots.map((s) => s.dish.name).join(",") === "Idly,Biryani,Wada",
  `Tuesday's menu is Idly / Biryani / Wada (got ${slots.map((s) => s.dish.name).join(", ")})`
);
check(
  slots[1]?.accompaniments.map((a) => a.dish.name).join(",") === "Kurma",
  "Kurma is derived from Item 2, not booked"
);

const dishes = await prisma.dish.findMany();
const byId = new Map(dishes.map((d) => [d.id, d]));

for (const [route, i1, i2, i3] of INDENT) {
  const { items, totalPlates } = await expandSlots(D, "BREAKFAST", { ITEM1: i1, ITEM2: i2, ITEM3: i3 });
  const qty = (name: string) => {
    const it = items.find((x) => byId.get(x.dishId)!.name === name);
    if (!it) return 0;
    const d = byId.get(it.dishId)!;
    return d.unit === "NOS" ? it.plates * d.packingFactor : round((it.plates * d.packingFactor) / 1000);
  };
  const got = NAMES.map(qty);
  const want = SHEET[route];
  const wrong = got
    .map((g, k) => (Math.abs(g - want[k]) > 0.01 ? `${NAMES[k]} ${g} != ${want[k]}` : null))
    .filter(Boolean);
  check(wrong.length === 0, `${route} cooked quantities match the sheet${wrong.length ? ` — ${wrong.join("; ")}` : ""}`);
  check(totalPlates === i1 + i2 + i3, `${route} total is the booker's plates, not the derived ones (${totalPlates})`);
}

console.log(`\n${fail === 0 ? "All" : `${pass}/${pass + fail}`} checks passed${fail ? ` — ${fail} FAILED` : "."}`);
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
