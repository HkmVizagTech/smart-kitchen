// The menu editor, for the kitchen (and super admin).
//
// The kitchen owns what is cooked. Bookers only choose how many plates, so a
// wrong menu here is a wrong indent everywhere downstream — which is why this
// writes a whole day at once, in a transaction, rather than letting a screen
// leave a day half-saved with two items and no third.
//
// Two kinds of row live in MenuSlot:
//
//   the PLAN     date = null, keyed by (session, week, day). This repeats.
//   an OVERRIDE  date = a specific day. It wins over the plan for that day only.
//
// Editing the plan changes every future occurrence of that weekday. Editing one
// date leaves the plan alone. The screen makes the difference explicit, because
// "Wednesday" and "this Wednesday" are not the same request.

import type { FastifyInstance } from "fastify";
import { prisma } from "@sk/db";
import { requireRole } from "../guard.js";
import { dayRange } from "../time.js";
import { menuFor } from "../menu.js";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const GROUPS = ["ITEM1", "ITEM2", "ITEM3"] as const;
const SESSIONS = ["BREAKFAST", "LUNCH", "DINNER"] as const;

type Group = (typeof GROUPS)[number];

/** One line as the editor sends it: a main dish, and what goes with it. */
interface SlotInput {
  group: Group | null;
  dishId: number;
  accompanimentIds?: number[];
}

export default async function menuAdminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireRole("KITCHEN_ADMIN"));

  // Everything the editor needs to draw itself: the dishes it can choose from
  // and how long each session's cycle runs.
  app.get("/menu-admin/options", async () => {
    const dishes = await prisma.dish.findMany({
      orderBy: [{ accompaniment: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, qtyPerPlate: true, unit: true,
        accompaniment: true, group: true,
      },
    });
    const cycles: Record<string, number> = {};
    for (const s of SESSIONS) {
      const max = await prisma.menuSlot.aggregate({
        where: { session: s, date: null },
        _max: { week: true },
      });
      cycles[s] = Math.max(1, max._max.week ?? 1);
    }
    return { dishes, days: DAYS, groups: GROUPS, cycles };
  });

  // The repeating plan for one session and week of its cycle: seven days, each
  // with up to three lines. Days with nothing planned come back empty rather
  // than missing, so the screen never has to guess which days exist.
  app.get<{ Querystring: { session: string; week?: string } }>(
    "/menu-admin/plan",
    async (req) => {
      const session = req.query.session as any;
      const week = Math.max(1, Number(req.query.week) || 1);
      const rows = await prisma.menuSlot.findMany({
        where: { session, week, date: null },
        include: { dish: true, accompaniments: { include: { dish: true } } },
        orderBy: [{ sortOrder: "asc" }],
      });
      return {
        session,
        week,
        days: DAYS.map((day) => ({
          day,
          slots: rows.filter((r) => r.day === day).map(shape),
        })),
      };
    }
  );

  // What a specific date resolves to, and whether that came from the plan or
  // from an override pinned to the date. The screen needs the difference to
  // label its own buttons honestly.
  app.get<{ Querystring: { date: string; session: string } }>(
    "/menu-admin/day",
    async (req) => {
      const date = new Date(req.query.date);
      const session = req.query.session as any;
      const pinned = await prisma.menuSlot.count({
        where: { session, date: dayRange(date) },
      });
      // Routes that have already booked this meal. Their order lines are
      // written at booking time, so a menu change now would not reach them —
      // the screen greys the edit out and says why, rather than letting
      // someone fill the form and only then be told no.
      const booked = await prisma.order.count({ where: { date: dayRange(date), session } });
      const slots = await menuFor(date, session);
      return {
        date: req.query.date,
        session,
        overridden: pinned > 0,
        booked,
        slots: slots.map(shape),
      };
    }
  );

  // Save one day of the repeating plan. Replaces that day outright: the editor
  // always sends the whole day, so a removed line disappears instead of
  // lingering as an orphan nobody can see.
  app.put<{
    Body: { session: string; week?: number; day: string; slots: SlotInput[] };
  }>("/menu-admin/plan", async (req, reply) => {
    const { session, day } = req.body;
    const week = Math.max(1, Number(req.body.week) || 1);
    const bad = validate(req.body.slots, session);
    if (bad) return reply.code(422).send({ error: bad });
    if (!DAYS.includes(day as any)) return reply.code(422).send({ error: "Unknown day." });

    await prisma.$transaction(async (tx) => {
      await tx.menuSlot.deleteMany({ where: { session: session as any, week, day: day as any, date: null } });
      await writeSlots(tx, req.body.slots, { session, week, day, date: null });
    });
    return { ok: true };
  });

  // Pin one calendar date, overriding the plan for that day only.
  app.put<{ Body: { session: string; date: string; slots: SlotInput[] } }>(
    "/menu-admin/day",
    async (req, reply) => {
      const { session, date } = req.body;
      const bad = validate(req.body.slots, session);
      if (bad) return reply.code(422).send({ error: bad });
      const when = new Date(date);
      if (Number.isNaN(when.getTime())) return reply.code(422).send({ error: "Unreadable date." });

      // Changing what was cooked after the fact does not change what was
      // ordered — order lines are written at booking time and stay as they
      // were. Blocking the edit is the honest answer.
      const booked = await prisma.order.count({ where: { date: dayRange(when), session: session as any } });
      if (booked > 0)
        return reply.code(409).send({
          error: `${booked} route${booked === 1 ? " has" : "s have"} already booked this meal. Changing the menu now would not change what they ordered.`,
        });

      await prisma.$transaction(async (tx) => {
        await tx.menuSlot.deleteMany({ where: { session: session as any, date: dayRange(when) } });
        await writeSlots(tx, req.body.slots, {
          session,
          week: 1,
          day: dayKey(when),
          date: new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate())),
        });
      });
      return { ok: true };
    }
  );

  // Drop an override, so the date falls back to the repeating plan again.
  app.delete<{ Querystring: { date: string; session: string } }>(
    "/menu-admin/day",
    async (req) => {
      const when = new Date(req.query.date);
      const res = await prisma.menuSlot.deleteMany({
        where: { session: req.query.session as any, date: dayRange(when) },
      });
      return { removed: res.count };
    }
  );
}

// ------------------------------------------------------------------ helpers

const WEEKDAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const dayKey = (d: Date) => WEEKDAY[d.getUTCDay()];

function shape(r: any) {
  return {
    id: r.id,
    group: r.group,
    sortOrder: r.sortOrder,
    dish: { id: r.dish.id, name: r.dish.name, qtyPerPlate: r.dish.qtyPerPlate, unit: r.dish.unit },
    accompaniments: r.accompaniments.map((a: any) => ({
      id: a.dish.id, name: a.dish.name, qtyPerPlate: a.dish.qtyPerPlate, unit: a.dish.unit,
    })),
  };
}

/** Returns a message if the day is not saveable, or null if it is. */
function validate(slots: SlotInput[] | undefined, session: string): string | null {
  if (!Array.isArray(slots)) return "Nothing to save.";
  if (!SESSIONS.includes(session as any)) return "Unknown meal.";

  // Lunch is booked as a headcount, so its lines carry no item group. Tiffin
  // and dinner are booked per item, so each of their lines must have one and
  // no two lines may claim the same item — the booker's three numbers would
  // have nowhere to go.
  if (session === "LUNCH") {
    if (slots.some((s) => s.group)) return "Lunch is booked as a headcount, so its dishes are not split into items.";
  } else {
    const groups = slots.map((s) => s.group);
    if (groups.some((g) => !g || !GROUPS.includes(g))) return "Every line needs an item number.";
    if (new Set(groups).size !== groups.length) return "Two lines cannot both be Item 1.";
  }
  if (slots.some((s) => !s.dishId)) return "Every line needs a dish.";
  return null;
}

async function writeSlots(
  tx: any,
  slots: SlotInput[],
  base: { session: string; week: number; day: string; date: Date | null }
) {
  // Sort order follows the item number for tiffin and dinner, and the order the
  // kitchen typed them for lunch.
  const ordered = [...slots].sort((a, b) =>
    a.group && b.group ? GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) : 0
  );
  for (const [i, s] of ordered.entries()) {
    const row = await tx.menuSlot.create({
      data: {
        session: base.session as any,
        week: base.week,
        day: base.day as any,
        group: s.group as any,
        sortOrder: i,
        dishId: s.dishId,
        date: base.date,
      },
    });
    const acc = [...new Set(s.accompanimentIds ?? [])].filter((id) => id !== s.dishId);
    if (acc.length > 0) {
      await tx.menuSlotAccompaniment.createMany({
        data: acc.map((dishId) => ({ slotId: row.id, dishId })),
      });
    }
  }
}
