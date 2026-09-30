// Seed data, taken from the kitchen's own spreadsheets.
//
// Booking model: a booker enters THREE plate counts — Item 1, Item 2, Item 3 —
// and the menu for that date decides which dishes those are. Lunch and
// emergency are a headcount only.
//
// PACKING FACTORS ARE NOT THE MENU-CARD QUANTITIES. The menu card says what a
// person is served; the packing factor is what the kitchen actually cooks, and
// the two differ. Every factor below was reverse-engineered from the real
// "Brandix Packing Sheet 28th Apr" and reproduces it exactly across all six
// routes:
//
//   Idly / Wada        4 pieces per plate
//   Sambar             60 g  (menu card says 65 g on Item 1, 75 g on Item 3)
//   FG Chutney         80 g  (menu card says 85 g)
//   Biryani            300 g, 20 kg cans
//   Kurma              120 g (menu card says 150 g), derived from the Biryani count
//
// Getting these wrong is not cosmetic — it changes how much food is cooked.

import { PrismaClient, DishUnit, DishGroup, VesselSession, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

// [name, group, qtyPerPlate, unit, packingFactor, packingVesselKg|null, sortOrder, accompaniment]
const DISHES: [string, DishGroup, number, DishUnit, number, number | null, number, boolean][] = [
  // ITEM 1
  ["Idly", "ITEM1", 4, "NOS", 4, null, 1, false],
  ["Sambar", "ITEM1", 65, "G", 60, 15, 2, true],
  ["FG Chutney", "ITEM1", 85, "G", 80, 15, 3, true],
  ["Tomato Chutney", "ITEM1", 50, "G", 50, 15, 4, true],
  // ITEM 2
  ["White Rice", "ITEM2", 300, "G", 300, 20, 1, false],
  ["Tomato Dal", "ITEM2", 150, "G", 150, 15, 2, true],
  ["Pachadi", "ITEM2", 50, "G", 50, 15, 3, true],
  ["Biryani", "ITEM2", 300, "G", 300, 20, 4, false],
  ["Kurma", "ITEM2", 150, "G", 120, 15, 5, true],
  ["Lemon Rice", "ITEM2", 300, "G", 300, 20, 6, false],
  ["Raita", "ITEM2", 50, "G", 50, 15, 8, true],
  ["Pulihora", "ITEM2", 300, "G", 300, 20, 9, false],
  // ITEM 3
  ["Punugulu", "ITEM3", 120, "G", 120, 20, 1, false],
  ["Wada", "ITEM3", 4, "NOS", 4, null, 2, false],
  ["Semiya Uppama", "ITEM3", 300, "G", 300, 20, 3, false],
  ["Mysore/Rawa Bhonda", "ITEM3", 4, "NOS", 4, null, 4, false],
  ["Bansi Rawa Uppama", "ITEM3", 300, "G", 300, 20, 5, false],
];


// ----------------------------------------------------------------- the menu
//
// Straight from "3 Items Menu 1st Jan 2026". Tiffin repeats weekly; lunch runs
// a fortnight. Nothing for Sunday in either sheet.
//
// Each row is one booking line: [session, week, day, group, order, main dish,
// accompaniments derived from THAT line's plate count]. On Tuesday, Kurma
// hangs off Biryani while Sambar hangs off both Idly and Wada — which is
// exactly why the real sheet's Sambar total is (idly + wada) plates x 60 g.
const MENU: [string, number, string, DishGroup | null, number, string, string[]][] = [
  // --- Tiffin, one-week cycle ---
  ["BREAKFAST", 1, "MON", "ITEM1", 0, "Idly", ["Sambar", "FG Chutney"]],
  ["BREAKFAST", 1, "MON", "ITEM2", 1, "White Rice", ["Tomato Dal", "Pachadi"]],
  ["BREAKFAST", 1, "MON", "ITEM3", 2, "Punugulu", ["Tomato Chutney", "FG Chutney"]],
  ["BREAKFAST", 1, "TUE", "ITEM1", 0, "Idly", ["Sambar", "FG Chutney"]],
  ["BREAKFAST", 1, "TUE", "ITEM2", 1, "Biryani", ["Kurma"]],
  ["BREAKFAST", 1, "TUE", "ITEM3", 2, "Wada", ["Sambar", "FG Chutney"]],
  ["BREAKFAST", 1, "WED", "ITEM1", 0, "Idly", ["Sambar", "FG Chutney"]],
  ["BREAKFAST", 1, "WED", "ITEM2", 1, "Lemon Rice", ["Tomato Chutney"]],
  ["BREAKFAST", 1, "WED", "ITEM3", 2, "Semiya Uppama", ["FG Chutney"]],
  ["BREAKFAST", 1, "THU", "ITEM1", 0, "Idly", ["Sambar", "FG Chutney"]],
  ["BREAKFAST", 1, "THU", "ITEM2", 1, "White Rice", ["Tomato Dal", "Pachadi"]],
  ["BREAKFAST", 1, "THU", "ITEM3", 2, "Mysore/Rawa Bhonda", ["Sambar", "FG Chutney"]],
  ["BREAKFAST", 1, "FRI", "ITEM1", 0, "Idly", ["Sambar", "FG Chutney"]],
  ["BREAKFAST", 1, "FRI", "ITEM2", 1, "Biryani", ["Raita"]],
  ["BREAKFAST", 1, "FRI", "ITEM3", 2, "Wada", ["Sambar", "FG Chutney"]],
  ["BREAKFAST", 1, "SAT", "ITEM1", 0, "Idly", ["Sambar", "FG Chutney"]],
  ["BREAKFAST", 1, "SAT", "ITEM2", 1, "Pulihora", []],
  ["BREAKFAST", 1, "SAT", "ITEM3", 2, "Bansi Rawa Uppama", ["FG Chutney"]],
];

// Lunch is booked as a headcount, so these slots exist to be READ, not
// ordered. group is null for the same reason.
const LUNCH_MENU: [number, string, string[]][] = [
  [1, "MON", ["Rice", "Louki Dal", "Sambar", "Coconut Rice", "Vankaya Batani", "Papad", "Cabbage Pachadi"]],
  [1, "TUE", ["Rice", "Tomato Dal", "Vammu Rasam", "Banana Fruit", "Cabbage Fry", "Mini Saggu Papad", "Coconut Pachadi"]],
  [1, "WED", ["Rice", "Dosakaya Dal", "Sambar", "Anawaram Sweet", "Aloo Capsicum Fry", "Fryums", "Dondakaya Pachadi"]],
  [1, "THU", ["Rice", "Gongora Dal", "Miryalu Rasam", "Pudina Rice", "Donda Fry", "Papad", "Anapkaya Pachadi"]],
  [1, "FRI", ["Rice", "Vankaya Dal", "Sambar", "Banana Fruit", "Raw Banana Fry", "Mini Saggu Papad", "Gongora Pachadi"]],
  [1, "SAT", ["Rice", "Tomato Dal", "Tomato Rasam", "Bhundi Sweet", "Aloo Fry", "Fryums", "Mix Veg Pachadi"]],
  [2, "MON", ["Rice", "Mango Pappu", "Pepper Rasam", "Pudina Rice", "Cabbage Fry", "Curd", "Anapkaya Pachadi", "Fryums"]],
  [2, "TUE", ["Rice", "Vankaya Dal", "Sambar", "Banana Fruit", "Aloo Capsicum Fry", "Curd", "Cabbage Pachadi", "Saggu Papad"]],
  [2, "WED", ["Rice", "Gongora Pappu", "Rasam", "Bhundi Sweet", "Bhendi Fry", "Curd", "Donda Pachadi", "Fryums"]],
  [2, "THU", ["Rice", "Jeera Pappu", "Sambar", "Coconut Rice", "Raw Banana Fry", "Curd", "Gongora Pachadi", "Saggu Papad"]],
  [2, "FRI", ["Rice", "Tomato Pappu", "Rasam", "Banana Fruit", "Dondakaya Fry", "Curd", "Mix Veg Pachadi", "Fryums"]],
  [2, "SAT", ["Rice", "Dosakaya Pappu", "Veg Sambar", "Anawaram Sweet", "Aloo Fry", "Curd", "Coconut Pachadi", "Papad"]],
];

const UNITS: [string, number, boolean][] = [
  ["Unit-1", 150, false],
  ["Unit-2", 250, false],
  ["Unit-3", 250, false],
  ["Unit-4", 150, false],
  ["Visakha", 20, false],
  ["Others", 0, true],
];

const VESSELS: Record<VesselSession, number[]> = {
  MORNING: [200, 160, 120, 80, 40],
  EVENING: [200, 160, 120, 100, 40],
};

// Starter accounts — [name, role, username].
//
// Passwords are NOT stored in this file. Literal passwords used to live here,
// which meant anyone who could read the repo could sign in. Instead:
//   * set SEED_PASSWORD to choose one, or
//   * leave it unset and the seed generates a random password per account and
//     prints it once, at the end of the run. Copy it then — it is not stored.
const USERS: [string, Role, string][] = [
  ["Booking Person", "BOOKING", "booking"],
  ["Kitchen Admin", "KITCHEN_ADMIN", "kitchen"],
  ["Verification Admin", "VERIFICATION_ADMIN", "verify"],
  ["Super Admin", "SUPER_ADMIN", "admin"],
];

function newPassword(): string {
  return process.env.SEED_PASSWORD || randomBytes(9).toString("base64url");
}

async function main() {
  console.log("Seeding…");

  for (const [name, group, qty, unit, pf, pv, sort, acc] of DISHES) {
    await prisma.dish.upsert({
      where: { name },
      update: { group, qtyPerPlate: qty, unit, packingFactor: pf, packingVesselKg: pv ?? null, sortOrder: sort, bookable: true, accompaniment: acc },
      create: { name, group, qtyPerPlate: qty, unit, packingFactor: pf, packingVesselKg: pv ?? undefined, sortOrder: sort, bookable: true, accompaniment: acc },
    });
  }

  // Lunch dishes exist so the day's menu can be SHOWN. They are not bookable —
  // lunch is a headcount — and carry no packing factor until someone needs one.
  const lunchNames = [...new Set(LUNCH_MENU.flatMap(([, , items]) => items))];
  for (const [i, name] of lunchNames.entries()) {
    await prisma.dish.upsert({
      where: { name },
      update: {},
      create: { name, group: "ITEM2", qtyPerPlate: 0, unit: "G", packingFactor: 0, packingVesselKg: 15, sortOrder: 100 + i, bookable: false },
    });
  }

  // --- the menu ---
  const dishId = async (name: string) => {
    const d = await prisma.dish.findUnique({ where: { name } });
    if (!d) throw new Error(`Menu refers to a dish that does not exist: ${name}`);
    return d.id;
  };

  // Replace the repeating plan wholesale, but leave any single-date overrides
  // an admin has made — those are deliberate one-offs, not seed data.
  await prisma.menuSlot.deleteMany({ where: { date: null } });

  for (const [session, week, day, group, sort, main, accs] of MENU) {
    const slot = await prisma.menuSlot.create({
      data: {
        session: session as any, week, day: day as any, group: group as any,
        sortOrder: sort, dishId: await dishId(main),
      },
    });
    for (const a of accs) {
      await prisma.menuSlotAccompaniment.create({
        data: { slotId: slot.id, dishId: await dishId(a) },
      });
    }
  }
  // Dinner: the sheets we were given cover tiffin and lunch only, but the
  // evening delivery sheet has the same three lines. Start it as a copy of
  // tiffin so the evening sheet is not blank, and let the kitchen edit it.
  for (const [session, week, day, group, sort, main, accs] of MENU) {
    if (session !== "BREAKFAST") continue;
    const slot = await prisma.menuSlot.create({
      data: {
        session: "DINNER", week, day: day as any, group: group as any,
        sortOrder: sort, dishId: await dishId(main),
      },
    });
    for (const a of accs) {
      await prisma.menuSlotAccompaniment.create({ data: { slotId: slot.id, dishId: await dishId(a) } });
    }
  }

  for (const [week, day, items] of LUNCH_MENU) {
    for (const [i, name] of items.entries()) {
      await prisma.menuSlot.create({
        data: { session: "LUNCH", week, day: day as any, group: null, sortOrder: i, dishId: await dishId(name) },
      });
    }
  }

  const unitByName: Record<string, number> = {};
  for (const [name, members, optional] of UNITS) {
    const u = await prisma.unit.upsert({
      where: { name },
      update: { memberCount: members, isOptional: optional },
      create: { name, memberCount: members, isOptional: optional },
    });
    unitByName[name] = u.id;
  }

  for (const session of Object.keys(VESSELS) as VesselSession[]) {
    for (const size of VESSELS[session]) {
      await prisma.vesselSize.upsert({
        where: { session_size: { session, size } },
        update: {},
        create: { session, size },
      });
    }
  }

  const issued: [string, string][] = [];
  for (const [name, role, username] of USERS) {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      // Never silently reset a password that is already in use.
      await prisma.user.update({ where: { username }, data: { name, role } });
      continue;
    }
    const password = newPassword();
    await prisma.user.create({
      data: { name, role, username, passwordHash: await bcrypt.hash(password, 10) },
    });
    issued.push([username, password]);
  }

  await prisma.setting.upsert({
    where: { key: "lunch_deadline" },
    update: { value: "11:00" },
    create: { key: "lunch_deadline", value: "11:00" },
  });

  console.log("Seed complete.");
  if (issued.length) {
    console.log("\nNew accounts — copy these passwords now, they are not stored:\n");
    for (const [username, password] of issued) console.log(`  ${username.padEnd(10)} ${password}`);
    console.log("\nChange them after first sign-in (Super Admin -> Users -> Reset password).\n");
  } else {
    console.log("All accounts already existed; no passwords were changed.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
