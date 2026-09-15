// Seed data. DEMO values where noted — editable later via Super Admin.
// Booking model: each dish is individually bookable with its own plate count,
// grouped Item 1 / Item 2 / Item 3. Same dish list every day. Lunch & emergency
// are count-only. Packing factors are taken from the menu-sheet quantities.

import { PrismaClient, DishUnit, DishGroup, VesselSession, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

// [name, group, qtyPerPlate, unit, packingFactor, packingVesselKg|null, sortOrder, accompaniment]
const DISHES: [string, DishGroup, number, DishUnit, number, number | null, number, boolean][] = [
  // ITEM 1
  ["Idly", "ITEM1", 4, "NOS", 4, null, 1, false],
  ["Sambar", "ITEM1", 65, "G", 65, 15, 2, true],
  ["FG Chutney", "ITEM1", 85, "G", 85, 15, 3, true],
  // ITEM 2
  ["White Rice", "ITEM2", 300, "G", 300, 20, 1, false],
  ["Tomato Dal", "ITEM2", 150, "G", 150, 15, 2, false],
  ["Pachadi", "ITEM2", 50, "G", 50, 15, 3, false],
  ["Biryani", "ITEM2", 300, "G", 300, 20, 4, false],
  ["Kurma", "ITEM2", 150, "G", 150, 15, 5, false],
  ["Lemon Rice", "ITEM2", 300, "G", 300, 20, 6, false],
  ["Raita", "ITEM2", 50, "G", 50, 15, 8, false],
  ["Pulihora", "ITEM2", 300, "G", 300, 20, 9, false],
  // ITEM 3
  ["Punugulu", "ITEM3", 120, "G", 120, 20, 1, false],
  ["Wada", "ITEM3", 4, "NOS", 4, null, 2, false],
  ["Semiya Uppama", "ITEM3", 300, "G", 300, 20, 3, false],
  ["Mysore/Rawa Bhonda", "ITEM3", 4, "NOS", 4, null, 4, false],
  ["Bansi Rawa Uppama", "ITEM3", 300, "G", 300, 20, 5, false],
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
