import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "@sk/db";
import { canPlaceOrder, DEFAULT_LUNCH_DEADLINE, type Session as Sess } from "@sk/logic";
import { notifyRoles, notifyUsers } from "../notify.js";
import { must, requireAuth, requireRole } from "../guard.js";
import { dayRange, requireYmd } from "../time.js";
import { expandSlots, menuFor } from "../menu.js";

/** The only meals there are. Anything else in a request body is a typo or a
    hand-rolled call, and reaches Prisma as an unknown enum value if not caught. */
const SESSIONS: Sess[] = ["BREAKFAST", "LUNCH", "DINNER"];

const SES_LABEL: Record<string, string> = { BREAKFAST: "Tiffin", LUNCH: "Lunch", DINNER: "Dinner" };

export default async function orderRoutes(app: FastifyInstance) {
  /** The lunch cutoff as configured, "HH:MM" in India time. */
  async function lunchDeadline(): Promise<string> {
    const row = await prisma.setting.findUnique({ where: { key: "lunch_deadline" } });
    return row?.value?.trim() || DEFAULT_LUNCH_DEADLINE;
  }

  // The booking screen prints the cutoff, so it has to read the same value the
  // rule uses rather than carrying its own copy of "11:00".
  app.get("/booking/rules", { preHandler: requireAuth }, async () => ({
    lunchDeadline: await lunchDeadline(),
  }));

  // What is on the menu for one date and meal.
  //
  // This is what makes the three-number booking form possible: the booker is
  // told "Item 1 is Idly today" rather than being asked to pick it out of a
  // list of sixteen. Accompaniments come back too, so the screen can show
  // what is added automatically.
  app.get<{ Querystring: { date: string; session: string } }>(
    "/menu",
    { preHandler: requireAuth },
    async (req) => {
      const slots = await menuFor(requireYmd(req.query.date), req.query.session);
      return {
        date: req.query.date,
        session: req.query.session,
        slots: slots.map((s) => ({
          group: s.group,
          sortOrder: s.sortOrder,
          dish: { id: s.dish.id, name: s.dish.name, qtyPerPlate: s.dish.qtyPerPlate, unit: s.dish.unit },
          accompaniments: s.accompaniments.map((a) => ({
            id: a.dish.id, name: a.dish.name, qtyPerPlate: a.dish.qtyPerPlate, unit: a.dish.unit,
          })),
        })),
      };
    }
  );

  // Bookable dishes grouped Item 1 / 2 / 3 (same list every day).
  app.get("/booking-menu", { preHandler: requireAuth }, async () => {
    const dishes = await prisma.dish.findMany({
      where: { bookable: true },
      orderBy: [{ group: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    });
    const group = (g: string) =>
      dishes
        .filter((d) => d.group === g)
        .map((d) => ({
          id: d.id,
          name: d.name,
          qtyPerPlate: d.qtyPerPlate,
          unit: d.unit,
          accompaniment: d.accompaniment,
        }));
    return { ITEM1: group("ITEM1"), ITEM2: group("ITEM2"), ITEM3: group("ITEM3") };
  });

  // Whether a route may still place its next order (reorder gate, per route).
  //
  // Pass ?session= to ask about one meal, which is what actually gates a
  // booking — tiffin and dinner are separate chains. Without it the answer
  // covers any open order on the route, which is the looser question.
  app.get<{ Params: { unitId: string }; Querystring: { session?: string } }>(
    "/units/:unitId/can-order",
    { preHandler: requireAuth },
    async (req) => {
    const unitId = Number(req.params.unitId);
    const open = req.query.session
      ? (await blockingOrderForUnit(unitId, req.query.session))?.order ?? null
      : await prisma.order.findFirst({
          where: { unitId, status: { not: "CLOSED" } },
          include: { consumption: true, feedback: true },
          orderBy: { date: "desc" },
        });
    if (!open) return { canOrder: true, reason: "No open order.", order: null };
    const step = nextStep(open);
    const needs = step === "nothing" ? [] : [step];
    return {
      canOrder: needs.length === 0,
      reason: needs[0] ?? "Ready.",
      openOrderId: open.id,
      order: {
        id: open.id,
        date: open.date,
        session: open.session,
        status: open.status,
        hasConsumption: !!open.consumption,
        hasFeedback: !!open.feedback,
        consumptionStatus: open.consumption?.status ?? null,
      },
    };
  }
  );

  // All of a unit's bookings (most recent first) for the My Bookings list.
  app.get<{ Params: { unitId: string } }>("/units/:unitId/orders", { preHandler: requireAuth }, async (req) => {
    const unitId = Number(req.params.unitId);
    const orders = await prisma.order.findMany({
      where: { unitId },
      include: { items: { include: { dish: true } }, consumption: true, feedback: true },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: 50,
    });
    return orders.map((o) => ({
      id: o.id,
      date: o.date,
      session: o.session,
      isEmergency: o.isEmergency,
      peopleCount: o.peopleCount,
      totalPlates: o.totalPlates,
      items: o.items.map((it) => ({ dish: it.dish.name, plates: it.plates })),
      // The three numbers the booker actually typed. Each main dish carries
      // its own item group, so this needs no menu lookup — and it is what
      // "repeat last" refills, since the dishes themselves change with the day.
      slots: o.items.reduce((acc, it) => {
        if (it.dish.accompaniment) return acc;
        acc[it.dish.group] = (acc[it.dish.group] ?? 0) + it.plates;
        return acc;
      }, {} as Record<string, number>),
      status: o.status,
      hasConsumption: !!o.consumption,
      hasFeedback: !!o.feedback,
      consumptionStatus: o.consumption?.status ?? null,
      // See the note on the same field in /bookings/recent: an emergency order
      // that was declined, or not yet decided, is not awaiting a close-out.
      needsCloseOut:
        o.approval === "DECLINED" || o.approval === "PENDING"
          ? false
          : !o.consumption || !o.feedback || o.consumption.status === "REJECTED",
      approval: o.approval,
      declineReason: o.declineReason,
    }));
  });

  // Place an order.
  //
  // The route defaults to the next free one for this date+session, but the
  // booker may override it by sending `unitId` — useful when a specific unit is
  // ordering for itself rather than taking whatever slot is open. Either way
  // one route holds at most one order per session (enforced by a unique index).
  // Tiffin/dinner: items=[{dishId,plates}].
  app.post<{
    Body: {
      date: string;
      session: Sess;
      isEmergency?: boolean;
      bookedById?: number;
      items?: { dishId: number; plates: number }[];
      /** The normal path: plate counts per booking line, expanded via the
       *  day's menu. `items` remains for callers that name dishes directly. */
      slots?: Partial<Record<"ITEM1" | "ITEM2" | "ITEM3", number>>;
      peopleCount?: number;
      /** Route to book. Omit to auto-assign the next free one. */
      unitId?: number;
    };
  }>("/orders", { preHandler: requireRole("BOOKING") }, async (req, reply) => {
    const b = req.body;
    // The booker is whoever is signed in — never a user id sent in the body.
    const bookedById = must(req).userId;
    // A Super Admin books only on a route's behalf — when its own booker is
    // away. That is a deliberate act, so they must name the route: auto-assign
    // would quietly hand them whichever one happened to be free, which is not
    // what "cover for Unit-3 today" means.
    const onBehalf = must(req).role === "SUPER_ADMIN";
    if (onBehalf && !b.unitId)
      return reply.code(422).send({ error: "Choose which route you are booking for." });

    const forDate = requireYmd(b.date, "booking date");
    if (!SESSIONS.includes(b.session))
      return reply.code(422).send({ error: "Choose breakfast, lunch or dinner." });
    const check = canPlaceOrder(b.session, new Date(), forDate, b.isEmergency, await lunchDeadline());
    if (!check.allowed) return reply.code(422).send({ error: check.reason });

    // One order per booker, per meal, per day. Applies whether the booker chose
    // a route or left it on auto — choosing a route changes WHERE the order
    // goes, not how many a person may place. Emergency orders are exempt.
    //
    // Two separate limits are in play and both matter:
    //   this one      — one person cannot book the same meal twice in a day
    //   the DB index  — one route holds at most one order per date+session
    //
    // An admin covering for more than one absent booker is the one case where
    // the first limit is wrong — they are placing one order per ROUTE, not two
    // of their own. The DB index still stops a route being booked twice.
    if (!b.isEmergency && !onBehalf) {
      const dup = await prisma.order.findFirst({
        where: { bookedById, session: b.session, isEmergency: false, date: dayRange(b.date) },
        include: { unit: true },
      });
      if (dup)
        return reply.code(409).send({
          error: `You have already booked ${SES_LABEL[b.session] ?? b.session} for this day (${dup.unit.name}).`,
        });
    }

    // The reorder gate. First order of a meal is free; after that the previous
    // one must be closed out. For an admin the chain follows the ROUTE they are
    // covering rather than the admin themselves, for the same reason: covering
    // Unit-3 should not be held up by an unclosed Unit-5.
    if (!b.isEmergency) {
      const blocked = onBehalf
        ? await blockingOrderForUnit(Number(b.unitId), b.session)
        : await blockingOrder(bookedById, b.session);
      if (blocked) {
        const when = blocked.order.date.toISOString().slice(0, 10);
        return reply.code(409).send({
          error:
            `Close out your previous ${SES_LABEL[b.session] ?? b.session} first ` +
            `(${blocked.order.unit.name}, ${when}) — ${blocked.needs.join(" and ")} still needed. ` +
            `Open "Close a Meal" to finish it, then book again.`,
          blockedBy: {
            orderId: blocked.order.id,
            unit: blocked.order.unit.name,
            date: blocked.order.date,
            session: blocked.order.session,
            needs: blocked.needs,
          },
        });
      }
    }

    // Pick the route: the booker's choice if they made one, otherwise the next
    // free one.
    const cov = await coverage(forDate, b.session);
    const meal = SES_LABEL[b.session]?.toLowerCase() ?? b.session.toLowerCase();
    let chosenUnit;
    if (b.unitId != null) {
      chosenUnit = cov.units.find((u) => u.id === b.unitId);
      if (!chosenUnit) return reply.code(422).send({ error: "That route no longer exists." });
      if (chosenUnit.booked)
        return reply
          .code(409)
          .send({ error: `${chosenUnit.name} is already booked for ${meal} on this date. Pick another route.` });
    } else {
      chosenUnit = cov.units.find((u) => !u.booked);
      if (!chosenUnit)
        return reply
          .code(409)
          .send({ error: `All ${cov.total} routes are already booked for ${meal} on this date.` });
    }
    const assignedUnitId = chosenUnit.id;

    // Turn what the booker sent into order lines.
    //
    // Normally that is three plate counts, expanded through the day's menu:
    // the menu knows which dish each line is and what comes with it. A caller
    // may still name dishes directly via `items`, which is how the older
    // clients and the end-to-end test work; that path derives accompaniments
    // the old way, from the Item 1 + Item 3 totals.
    let finalItems: { dishId: number; plates: number }[] = [];
    let totalPlates = 0;

    if (b.slots && Object.keys(b.slots).length > 0) {
      const expanded = await expandSlots(forDate, b.session, b.slots);
      if (expanded.missing)
        return reply.code(422).send({
          error: `No menu is set for ${SES_LABEL[b.session] ?? b.session} on this day. Ask the kitchen to set one.`,
        });
      if (expanded.totalPlates === 0)
        return reply.code(422).send({ error: "Enter a plate count for at least one item." });
      finalItems = expanded.items;
      totalPlates = expanded.totalPlates;
    } else {
      const allDishes = await prisma.dish.findMany({ where: { bookable: true } });
      const byId = new Map(allDishes.map((d) => [d.id, d]));
      const entered = (b.items ?? [])
        .filter((it) => it.dishId && it.plates > 0)
        .filter((it) => !byId.get(it.dishId)?.accompaniment);

      if (b.session !== "LUNCH" && !b.isEmergency && entered.length === 0)
        return reply.code(422).send({ error: "Add at least one dish with a plate count." });

      const solidTotal = entered.reduce((a, it) => {
        const g = byId.get(it.dishId)?.group;
        return g === "ITEM1" || g === "ITEM3" ? a + it.plates : a;
      }, 0);
      const accDishes = allDishes.filter((d) => d.accompaniment);
      const derived =
        solidTotal > 0 ? accDishes.map((d) => ({ dishId: d.id, plates: solidTotal })) : [];

      finalItems = [...entered, ...derived];
      totalPlates = entered.reduce((a, it) => a + it.plates, 0);
    }

    try {
      const order = await prisma.order.create({
        data: {
          unitId: assignedUnitId,
          bookedById,
          date: forDate,
          session: b.session,
          isEmergency: b.isEmergency ?? false,
          // An emergency order waits for an admin. The screen has always said
          // so; until now nobody was actually asked.
          approval: b.isEmergency ? "PENDING" : null,
          peopleCount: b.peopleCount,
          totalPlates: finalItems.length ? totalPlates : b.peopleCount ?? null,
          items: finalItems.length
            ? { create: finalItems.map((it) => ({ dishId: it.dishId, plates: it.plates })) }
            : undefined,
        },
        include: { items: true, unit: true },
      });
      const after = await coverage(forDate, b.session);
      const where = `${chosenUnit.name} · ${SES_LABEL[b.session] ?? b.session}`;
      if (order.isEmergency) {
        // Goes to the admins to decide, not to the kitchen to cook. The kitchen
        // is told once it is approved.
        await notifyRoles(["SUPER_ADMIN"], {
          type: "EMERGENCY_REQUESTED",
          title: "Emergency order to approve",
          body: `${where} · ${order.peopleCount ?? 0} people — waiting for your decision.`,
          section: "orders",
          orderId: order.id,
        });
      } else {
        await notifyRoles(["KITCHEN_ADMIN", "SUPER_ADMIN"], {
          type: "ORDER_PLACED",
          title: "New booking",
          body: `${where} · ${order.totalPlates ?? 0} plates`,
          section: "orders",
          orderId: order.id,
        });
      }
      return { ...order, assignedUnit: chosenUnit.name, booked: after.booked, total: after.total };
    } catch (e: any) {
      if (e.code === "P2002")
        return reply.code(409).send({ error: "That route is already booked for this session." });
      throw e;
    }
  });


  // ---------------------------------------------------------------- the gate
  //
  // A booker may place their FIRST order for a meal freely. Every order after
  // that requires the previous one in the same meal to be closed out —
  // consumption submitted AND feedback submitted. That is the loop the whole
  // system exists to enforce, and until now it was only *reported* by
  // /units/:id/can-order; nothing stopped a client that simply did not ask.
  //
  // Two deliberate limits on how strict this is:
  //
  //   Per MEAL, not across meals. Tiffin and dinner are separate chains. A
  //   shared gate would deadlock: you book tiffin + dinner for tomorrow, close
  //   out tiffin in the morning, and dinner is not delivered until evening — so
  //   you could not book the next day's tiffin before the cutoff.
  //
  //   Verification IS on the critical path, deliberately. The kitchen asked for
  //   consumption -> verification -> feedback -> next order, in that order, so a
  //   route that has not been checked cannot keep booking. The cost is real: if
  //   nobody verifies before the cutoff, that route misses a meal. The queue is
  //   small and same-day, and the alternative — letting unchecked figures pile
  //   up — is what the chain exists to prevent.
  //
  // Emergency orders are exempt, by definition.
  async function blockingOrder(bookedById: number, session: string) {
    const open = await prisma.order.findFirst({
      where: {
        bookedById,
        session: session as any,
        isEmergency: false,
        OR: [{ consumption: { is: null } }, { feedback: { is: null } }],
      },
      include: { unit: true, consumption: true, feedback: true },
      orderBy: { date: "asc" },
    });
    if (!open) return null;
    return { order: open, needs: [nextStep(open)] };
  }

  /**
   * The same gate, keyed on the route rather than the person.
   *
   * Used when a Super Admin books on a route's behalf: the obligation belongs
   * to the route being covered, so covering two absent bookers at once is not
   * treated as one person trying to order twice.
   */
  async function blockingOrderForUnit(unitId: number, session: string) {
    const open = await prisma.order.findFirst({
      where: {
        unitId,
        session: session as any,
        isEmergency: false,
        OR: [{ consumption: { is: null } }, { feedback: { is: null } }],
      },
      include: { unit: true, consumption: true, feedback: true },
      orderBy: { date: "asc" },
    });
    if (!open) return null;
    return { order: open, needs: [nextStep(open)] };
  }

  /** The one thing standing between this order and the route's next booking. */
  function nextStep(o: {
    consumption: { status: string } | null;
    feedback: unknown | null;
  }): string {
    if (!o.consumption) return "enter consumption";
    if (o.consumption.status === "REJECTED") return "correct the consumption that was sent back";
    if (o.consumption.status !== "VERIFIED") return "wait for verification";
    if (!o.feedback) return "give feedback on the food";
    return "nothing";
  }


  // Per-meal booking status for the signed-in booker: what they may book right
  // now, and what is blocking anything they may not. The New Booking screen
  // reads this so a booker is told up front rather than after filling a form.
  app.get("/me/booking-status", { preHandler: requireAuth }, async (req) => {
    const me = must(req);
    const sessions = ["BREAKFAST", "LUNCH", "DINNER"] as const;
    const out: Record<string, unknown> = {};
    // An admin's gate is per route, not per person (see blockingOrderForUnit),
    // so there is no single meal-level answer to give them here. Their screen
    // asks per route instead, once they have chosen one.
    if (me.role === "SUPER_ADMIN") {
      for (const session of sessions) out[session] = { canOrder: true, blockedBy: null };
      return out;
    }
    for (const session of sessions) {
      const blocked = await blockingOrder(me.userId, session);
      out[session] = blocked
        ? {
            canOrder: false,
            blockedBy: {
              orderId: blocked.order.id,
              unit: blocked.order.unit.name,
              date: blocked.order.date,
              needs: blocked.needs,
            },
          }
        : { canOrder: true, blockedBy: null };
    }
    return out;
  });

  // Kitchen coverage for a date+session: which of the 6 kitchens are booked.
  async function coverage(date: Date, session: string) {
    const units = await prisma.unit.findMany({ orderBy: { id: "asc" } });
    const booked = await prisma.order.findMany({
      where: { date: dayRange(date), session: session as any },
      select: { unitId: true },
    });
    const bookedSet = new Set(booked.map((o) => o.unitId));
    const list = units.map((u) => ({ id: u.id, name: u.name, booked: bookedSet.has(u.id) }));
    return { total: units.length, booked: bookedSet.size, units: list, ready: bookedSet.size >= units.length };
  }

  // Progress for the booking app: how many kitchens are covered.
  app.get<{ Querystring: { date: string; session: string } }>(
    "/booking/progress",
    { preHandler: requireAuth },
    async (req) => coverage(requireYmd(req.query.date), req.query.session)
  );

  // Recent orders across all kitchens.
  //
  // This returns EVERY booker's orders, not just the caller's — the kitchen and
  // admin screens want the whole picture. The row therefore carries who placed
  // it, so a client showing "My Bookings" can filter, and so the booking screen
  // can offer to repeat the caller's OWN last order rather than a stranger's.
  app.get("/bookings/recent", { preHandler: requireAuth }, async (req) => {
    const session = must(req);
    const me = session.userId;
    // A booker sees their own orders and nothing else. This used to return the
    // last 60 orders in the kitchen to anyone signed in, which is why one
    // booking appeared identically on every screen — and why the close-out
    // picker was offering people other routes' meals to close.
    //
    // The three admin roles still see everything: the kitchen cooks from it,
    // verification checks it, and a Super Admin has to be able to see a route
    // they booked on behalf of.
    const everyone = session.role !== "BOOKING";
    const orders = await prisma.order.findMany({
      where: everyone ? {} : { bookedById: me },
      include: {
        unit: true,
        items: { include: { dish: true } },
        consumption: true,
        feedback: true,
        bookedBy: { select: { name: true, role: true } },
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: 60,
    });
    const cutoff = await lunchDeadline();
    const now = new Date();
    return orders.map((o) => ({
      id: o.id,
      unit: o.unit.name,
      date: o.date,
      session: o.session,
      isEmergency: o.isEmergency,
      peopleCount: o.peopleCount,
      totalPlates: o.totalPlates,
      items: o.items.map((it) => ({ dish: it.dish.name, plates: it.plates })),
      slots: o.items.reduce((acc, it) => {
        if (it.dish.accompaniment) return acc;
        acc[it.dish.group] = (acc[it.dish.group] ?? 0) + it.plates;
        return acc;
      }, {} as Record<string, number>),
      status: o.status,
      consumptionStatus: o.consumption?.status ?? null,
      hasFeedback: !!o.feedback,
      // Why it was sent back, so the booker can fix the right thing.
      rejectionReason: o.consumption?.rejectionReason ?? null,
      amount: o.consumption?.amount ?? null,
      // A returned close-out needs work again. Without the REJECTED case the
      // booker was notified that verification had sent it back, and then could
      // not find it anywhere: the consumption row existed, so this said false
      // and the order dropped off both the "needs close-out" list and the
      // close-out picker.
      // A declined emergency order never became food, so there is nothing to
      // close out. One still awaiting a decision is not the route's move either.
      needsCloseOut:
        o.approval === "DECLINED" || o.approval === "PENDING"
          ? false
          : !o.consumption || !o.feedback || o.consumption.status === "REJECTED",
      approval: o.approval,
      declineReason: o.declineReason,
      // Whether the Change button should appear. Worked out here rather than
      // in the browser so the screen and the rule cannot disagree: see the
      // conditions on PATCH /orders/:id.
      canEdit:
        o.status === "PLACED" &&
        !o.consumption &&
        (!o.isEmergency || o.approval === "PENDING") &&
        canPlaceOrder(o.session as Sess, now, o.date, o.isEmergency, cutoff).allowed,
      bookedById: o.bookedById,
      mine: o.bookedById === me,
      // Who actually placed it. An order a Super Admin booked on a route's
      // behalf has to read that way everywhere it appears, or the kitchen has
      // no idea the route's own booker never saw it.
      placedBy: o.bookedBy ? { name: o.bookedBy.name, role: o.bookedBy.role } : null,
      onBehalf: o.bookedBy?.role === "SUPER_ADMIN",
    }));
  });

  /**
   * Change an order that is already placed.
   *
   * The commonest complaint about this system was that a mistyped plate count
   * could not be undone — the route had to telephone the kitchen. A booker can
   * now correct their own order, but only while nothing has been done with it:
   *
   *   · it is theirs (a Super Admin may fix any)
   *   · the ordering window for that meal is still open, so the kitchen has
   *     not bought or prepped against the old numbers
   *   · the kitchen has not started it — still PLACED, not preparing or later
   *   · no close-out has begun
   *
   * Only the quantities change. Moving a booking to another route, day or meal
   * is a different order, not an edit of this one, and the route's one-order
   * -per-meal-per-day rule is what makes that distinction matter.
   */
  app.patch<{ Params: { id: string }; Body: { slots?: Record<string, number>; peopleCount?: number } }>(
    "/orders/:id",
    { preHandler: requireAuth },
    async (req, reply) => {
      const id = Number(req.params.id);
      const order = await prisma.order.findUnique({
        where: { id },
        include: { unit: true, consumption: true },
      });
      if (!order) return reply.code(404).send({ error: "Order not found." });

      const me = must(req);
      const admin = me.role === "SUPER_ADMIN";
      if (!admin && order.bookedById !== me.userId)
        return reply.code(403).send({ error: "That booking was placed by someone else." });

      if (order.status !== "PLACED")
        return reply.code(409).send({
          error: `The kitchen has already started this one (${order.status.toLowerCase()}). Call them if it has to change.`,
        });
      if (order.consumption)
        return reply.code(409).send({ error: "This meal is already being closed out." });
      if (order.isEmergency && order.approval !== "PENDING")
        return reply.code(409).send({ error: "An emergency order cannot be changed once it has been decided." });

      // The same window that governs placing it governs changing it. Past the
      // cutoff the kitchen is already working to these numbers.
      const win = canPlaceOrder(
        order.session as Sess, new Date(), order.date, order.isEmergency, await lunchDeadline()
      );
      if (!win.allowed)
        return reply.code(422).send({ error: `Too late to change this one — ${win.reason.toLowerCase()}` });

      // Headcount meals (lunch, emergency) carry a count; the rest carry the
      // three plate counts, re-expanded through that day's menu.
      if (order.session === "LUNCH" || order.isEmergency) {
        const n = Number(req.body.peopleCount);
        if (!Number.isFinite(n) || n <= 0)
          return reply.code(422).send({ error: "Enter how many people are eating." });
        const updated = await prisma.order.update({
          where: { id }, data: { peopleCount: n, totalPlates: n },
        });
        return { ok: true, totalPlates: updated.totalPlates };
      }

      const slots = req.body.slots ?? {};
      const expanded = await expandSlots(order.date, order.session, slots);
      if (expanded.missing)
        return reply.code(422).send({ error: "No menu is set for this day any more." });
      if (expanded.totalPlates === 0)
        return reply.code(422).send({ error: "Enter a plate count for at least one item." });

      // Replaced outright rather than merged: a line the booker removed has to
      // disappear, not linger at its old count where nobody can see it.
      await prisma.$transaction(async (tx) => {
        await tx.orderItem.deleteMany({ where: { orderId: id } });
        await tx.orderItem.createMany({
          data: expanded.items.map((it) => ({ orderId: id, dishId: it.dishId, plates: it.plates })),
        });
        await tx.order.update({ where: { id }, data: { totalPlates: expanded.totalPlates } });
      });

      await notifyRoles(["KITCHEN_ADMIN"], {
        type: "ORDER_CHANGED",
        title: "Booking changed",
        body: `${order.unit.name} · ${SES_LABEL[order.session] ?? order.session} — now ${expanded.totalPlates} plates.`,
        section: "orders",
        orderId: id,
      });
      return { ok: true, totalPlates: expanded.totalPlates };
    }
  );

  /**
   * Decide an emergency order.
   *
   * The booking screen has always said an emergency order "needs admin
   * approval". It did not: the order was placed and the kitchen simply saw it.
   * This is the step that was missing. Until it is approved the order is not
   * on the kitchen's list and not in the packing sheet, so nothing is cooked
   * on the strength of a request nobody has agreed to.
   */
  app.post<{ Params: { id: string }; Body: { approve: boolean; reason?: string } }>(
    "/orders/:id/approval",
    { preHandler: requireRole("SUPER_ADMIN") },
    async (req, reply) => {
      const id = Number(req.params.id);
      const reason = (req.body.reason ?? "").trim();
      const order = await prisma.order.findUnique({ where: { id }, include: { unit: true } });
      if (!order) return reply.code(404).send({ error: "Order not found." });
      if (!order.isEmergency)
        return reply.code(422).send({ error: "Only emergency orders need approval." });
      if (order.approval !== "PENDING")
        return reply.code(409).send({ error: `This one was already ${order.approval?.toLowerCase()}.` });
      // Turning a request down without saying why leaves the route guessing,
      // on the day something has already gone wrong for them.
      if (!req.body.approve && reason.length < 3)
        return reply.code(422).send({ error: "Say why it is being declined." });

      const updated = await prisma.order.update({
        where: { id },
        data: {
          approval: req.body.approve ? "APPROVED" : "DECLINED",
          approvedById: must(req).userId,
          approvedAt: new Date(),
          declineReason: req.body.approve ? null : reason,
        },
      });

      const where = `${order.unit.name} · ${SES_LABEL[order.session] ?? order.session}`;
      if (order.bookedById) {
        await notifyUsers([order.bookedById], req.body.approve
          ? { type: "EMERGENCY_APPROVED", title: "Emergency order approved",
              body: `${where} — the kitchen has it.`, section: "mine", orderId: id }
          : { type: "EMERGENCY_DECLINED", title: "Emergency order declined",
              body: `${where} — ${reason}`, section: "mine", orderId: id });
      }
      if (req.body.approve) {
        await notifyRoles(["KITCHEN_ADMIN"], {
          type: "ORDER_PLACED",
          title: "Emergency order approved",
          body: `${where} · ${order.peopleCount ?? 0} people — cook this.`,
          section: "orders",
          orderId: id,
        });
      }
      return { ok: true, approval: updated.approval };
    }
  );

  /** Emergency orders still waiting on a decision. */
  app.get("/orders/emergency/pending", { preHandler: requireRole("SUPER_ADMIN") }, async () => {
    const rows = await prisma.order.findMany({
      where: { isEmergency: true, approval: "PENDING" },
      include: { unit: true, bookedBy: { select: { name: true } } },
      orderBy: { id: "asc" },
    });
    return rows.map((o) => ({
      id: o.id,
      unit: o.unit.name,
      session: o.session,
      date: o.date,
      peopleCount: o.peopleCount,
      requestedBy: o.bookedBy?.name ?? null,
    }));
  });

  // List orders for a date (+ optional session), with line items.
  app.get<{ Querystring: { date: string; session?: string } }>(
    "/orders",
    { preHandler: requireAuth },
    async (req) => {
    const { session } = req.query;
    const date = requireYmd(req.query.date);
    return prisma.order.findMany({
      where: {
        date: dayRange(date),
        ...(session ? { session: session as any } : {}),
        // An emergency order appears here only once approved. A declined or
        // still-pending one is not something to cook.
        OR: [{ isEmergency: false }, { approval: "APPROVED" }],
      },
      // The kitchen cooks from this list, so it carries who placed each order:
      // one booked by an admin on a route's behalf means that route's own
      // booker never saw it, which is worth knowing before a query about it.
      include: {
        unit: true,
        items: { include: { dish: true } },
        bookedBy: { select: { name: true, role: true } },
      },
      orderBy: { unitId: "asc" },
    });
  });

  /**
   * May this caller close out this order?
   *
   * Whoever placed it, and nobody else — bar a Super Admin, who can act on any
   * of them because they are the one who books on a route's behalf when its
   * booker is away, and so has to be able to finish what they started.
   *
   * None of the close-out routes checked this before. The picker listed every
   * open meal in the kitchen, so any booker could enter consumption figures for
   * a route they had never seen — and those figures are what the payment amount
   * is calculated from.
   */
  function mayCloseOut(req: FastifyRequest, order: { bookedById: number | null }): boolean {
    const me = must(req);
    return me.role === "SUPER_ADMIN" || order.bookedById === me.userId;
  }
  const NOT_YOURS = "That meal was booked by someone else. You can only close out your own.";

  // Main items of an order (non-accompaniment) with ordered plates — for close-out.
  app.get<{ Params: { id: string } }>("/orders/:id/closeout-items", { preHandler: requireAuth }, async (req, reply) => {
    const order = await prisma.order.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        items: { include: { dish: true } },
        unit: true,
        consumption: { include: { items: true } },
        feedback: true,
      },
    });
    if (!order) return reply.code(404).send({ error: "Order not found." });
    if (!mayCloseOut(req, order)) return reply.code(403).send({ error: NOT_YOURS });
    // Anything already submitted comes back with the items, so a close-out that
    // was returned for a correction is re-opened with the previous numbers in
    // place. Retyping every line to fix one of them is how a booker ends up
    // introducing a second mistake.
    const before = new Map((order.consumption?.items ?? []).map((c) => [c.dishId, c.consumed]));
    const items = order.items
      .filter((it) => !it.dish.accompaniment)
      .map((it) => ({
        dishId: it.dishId,
        name: it.dish.name,
        ordered: it.plates,
        consumed: before.has(it.dishId) ? before.get(it.dishId)! : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // Which of the two steps the booker is on. The screen reads this rather
    // than working it out from three separate booleans.
    const stage: "CONSUMPTION" | "AWAITING_VERIFICATION" | "FEEDBACK" | "DONE" = !order.consumption
      ? "CONSUMPTION"
      : order.consumption.status === "REJECTED"
        ? "CONSUMPTION"
        : order.consumption.status === "PENDING"
          ? "AWAITING_VERIFICATION"
          : order.feedback
            ? "DONE"
            : "FEEDBACK";

    return {
      orderId: order.id,
      unit: order.unit.name,
      session: order.session,
      date: order.date,
      stage,
      items,
      previous: order.consumption
        ? {
            status: order.consumption.status,
            notes: order.consumption.notes,
            rejectionReason: order.consumption.rejectionReason,
            taste: order.feedback?.taste ?? null,
            quality: order.feedback?.quality ?? null,
            remarks: order.feedback?.remarks ?? null,
          }
        : null,
    };
  });

  // Step 1 of the close-out: how many plates were actually consumed.
  //
  // Feedback used to be collected in this same call. It is now a separate step
  // that opens only after the team has verified these numbers — the kitchen
  // wants the counts checked before it reads what anyone thought of the food,
  // so a complaint arrives attached to figures someone has already stood behind.
  app.post<{
    Body: {
      orderId: number;
      items: { dishId: number; consumed: number }[];
      notes?: string;
    };
  }>("/orders/consumption", { preHandler: requireRole("BOOKING") }, async (req, reply) => {
    const b = req.body;
    const order = await prisma.order.findUnique({
      where: { id: b.orderId },
      include: { items: { include: { dish: true } }, unit: true },
    });
    if (!order) return reply.code(404).send({ error: "Order not found." });
    if (!mayCloseOut(req, order)) return reply.code(403).send({ error: NOT_YOURS });

    // ordered comes from the order itself (main items only); leftover = ordered - consumed.
    // Consumed may legitimately exceed ordered (extra plates served) — that's fine,
    // payment is based on consumed. Leftover is floored at 0 per item.
    const mains = order.items.filter((it) => !it.dish.accompaniment);
    const consumedMap = new Map((b.items ?? []).map((x) => [x.dishId, Math.max(0, x.consumed || 0)]));
    const rows = mains.map((it) => ({
      dishId: it.dishId,
      ordered: it.plates,
      consumed: consumedMap.get(it.dishId) ?? 0,
    }));
    const receivedQty = rows.reduce((a, r) => a + r.ordered, 0);
    const consumedQty = rows.reduce((a, r) => a + r.consumed, 0);
    const leftoverQty = rows.reduce((a, r) => a + Math.max(0, r.ordered - r.consumed), 0);

    await prisma.$transaction(async (tx) => {
      const existing = await tx.consumption.findUnique({ where: { orderId: b.orderId } });
      if (existing) await tx.consumptionItem.deleteMany({ where: { consumptionId: existing.id } });
      const cons = await tx.consumption.upsert({
        where: { orderId: b.orderId },
        // Resubmitting clears the previous rejection reason — it described the
        // version that was sent back, and leaving it would make a corrected
        // close-out still look rejected.
        update: {
          receivedQty, consumedQty, leftoverQty, notes: b.notes,
          status: "PENDING", rejectionReason: null,
        },
        create: { orderId: b.orderId, receivedQty, consumedQty, leftoverQty, notes: b.notes },
      });
      await tx.consumptionItem.createMany({
        data: rows.map((r) => ({ consumptionId: cons.id, dishId: r.dishId, ordered: r.ordered, consumed: r.consumed })),
      });
    });
    // Tell verification + super admin a close-out is waiting.
    await notifyRoles(["VERIFICATION_ADMIN", "SUPER_ADMIN"], {
      type: "CLOSEOUT_SUBMITTED",
      title: "Close-out to verify",
      body: `${order.unit.name} · ${SES_LABEL[order.session] ?? order.session} · ${consumedQty} plates consumed — awaiting verification.`,
      section: "verify",
      orderId: order.id,
    });
    return { ok: true };
  });

  // Step 2 of the close-out: how the food was. Opens only once the consumption
  // for this order has been verified, and completing it is what closes the
  // order and lets the route book again.
  app.post<{
    Body: { orderId: number; taste: number; quality: number; remarks?: string };
  }>("/orders/feedback", { preHandler: requireRole("BOOKING") }, async (req, reply) => {
    const { orderId, taste, quality } = req.body;
    const remarks = (req.body.remarks ?? "").trim();
    if (!taste || !quality)
      return reply.code(422).send({ error: "Rate both taste and quality." });

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { consumption: true, unit: true },
    });
    if (!order) return reply.code(404).send({ error: "Order not found." });
    if (!mayCloseOut(req, order)) return reply.code(403).send({ error: NOT_YOURS });
    if (!order.consumption)
      return reply.code(409).send({ error: "Enter the consumption first." });
    if (order.consumption.status === "REJECTED")
      return reply.code(409).send({ error: "This close-out was sent back — fix the consumption first." });
    if (order.consumption.status !== "VERIFIED")
      return reply.code(409).send({ error: "Feedback opens once the team has verified your consumption." });

    await prisma.$transaction(async (tx) => {
      await tx.feedback.upsert({
        where: { orderId },
        update: { taste, quality, remarks },
        create: { orderId, taste, quality, remarks },
      });
      await tx.order.update({ where: { id: orderId }, data: { status: "CLOSED" } });
    });

    // A low score, or anything written in the box, is something the kitchen
    // should see the same day rather than at the end of the month.
    if (Math.min(taste, quality) <= 3 || remarks) {
      await notifyRoles(["KITCHEN_ADMIN", "SUPER_ADMIN"], {
        type: "FEEDBACK",
        title: Math.min(taste, quality) <= 3 ? "Low feedback score" : "Feedback received",
        body: `${order.unit.name} · ${SES_LABEL[order.session] ?? order.session} — taste ${taste}/5, quality ${quality}/5${remarks ? `: ${remarks}` : ""}`,
        section: "orders",
        orderId,
      });
    }
    return { ok: true };
  });

  // Kitchen advances an order's status (PREPARING / DISPATCHED / DELIVERED).
  app.post<{ Params: { id: string }; Body: { status: string } }>(
    "/orders/:id/status",
    { preHandler: requireRole("KITCHEN_ADMIN") },
    async (req, reply) => {
      const allowed = ["PLACED", "PREPARING", "DISPATCHED", "DELIVERED"];
      if (!allowed.includes(req.body.status))
        return reply.code(422).send({ error: "Invalid status." });
      const order = await prisma.order.update({
        where: { id: Number(req.params.id) },
        data: { status: req.body.status as any },
        include: { unit: true },
      });
      await notifyStatus(order);
      return order;
    }
  );

  // Notify the booker when their order's status moves (esp. DELIVERED).
  async function notifyStatus(order: { id: number; status: string; bookedById: number | null; session: string; unit: { name: string } }) {
    if (!order.bookedById) return;
    const where = `${order.unit.name} · ${SES_LABEL[order.session] ?? order.session}`;
    if (order.status === "DELIVERED") {
      await notifyUsers([order.bookedById], {
        type: "DELIVERED",
        title: "Meal delivered — close it out",
        body: `${where} was delivered. Fill the close-out & feedback in “Close a Meal” to unlock your next order.`,
        section: "close",
        orderId: order.id,
      });
    } else {
      await notifyUsers([order.bookedById], {
        type: "STATUS",
        title: `Order ${order.status.toLowerCase()}`,
        body: `${where} is now ${order.status.toLowerCase()}.`,
        section: "mine",
        orderId: order.id,
      });
    }
  }

  // Bulk advance — forward only (never downgrades an already-further order).
  const ORDER_FLOW = ["PLACED", "PREPARING", "DISPATCHED", "DELIVERED"];
  app.post<{ Body: { date: string; session?: string; status: string } }>(
    "/orders/status/bulk",
    { preHandler: requireRole("KITCHEN_ADMIN") },
    async (req, reply) => {
      const target = req.body.status;
      const ti = ORDER_FLOW.indexOf(target);
      if (ti <= 0) return reply.code(422).send({ error: "Invalid status." });
      const day = requireYmd(req.body.date);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const earlier = ORDER_FLOW.slice(0, ti); // only orders before the target move up
      const where = {
        date: { gte: day, lt: next },
        status: { in: earlier as any },
        ...(req.body.session ? { session: req.body.session as any } : {}),
      };
      // Capture which orders will actually change (for notifications).
      const changing = await prisma.order.findMany({
        where,
        select: { id: true, bookedById: true, session: true, unit: { select: { name: true } } },
      });
      const res = await prisma.order.updateMany({ where, data: { status: target as any } });
      for (const o of changing) {
        await notifyStatus({ id: o.id, status: target, bookedById: o.bookedById, session: o.session, unit: o.unit });
      }
      return { updated: res.count };
    }
  );

  // Orders awaiting verification (consumption submitted, not yet verified).
  app.get("/verification/pending", { preHandler: requireRole("VERIFICATION_ADMIN") }, async () => {
    const cons = await prisma.consumption.findMany({
      where: { status: "PENDING" },
      include: {
        order: { include: { unit: true } },
        items: { include: { dish: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return cons.map((c) => ({
      orderId: c.orderId,
      unit: c.order.unit.name,
      session: c.order.session,
      date: c.order.date,
      received: c.receivedQty,
      consumed: c.consumedQty,
      leftover: c.leftoverQty,
      notes: c.notes,
      items: c.items
        .map((it) => ({
          name: it.dish.name,
          ordered: it.ordered,
          consumed: it.consumed,
          leftover: Math.max(0, it.ordered - it.consumed),
          extra: Math.max(0, it.consumed - it.ordered),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
  });

  // Verified history (for the payments view).
  app.get("/verification/done", { preHandler: requireRole("VERIFICATION_ADMIN") }, async () => {
    const cons = await prisma.consumption.findMany({
      where: { status: "VERIFIED" },
      include: { order: { include: { unit: true } } },
      orderBy: { verifiedAt: "desc" },
      take: 100,
    });
    return cons.map((c) => ({
      orderId: c.orderId,
      unit: c.order.unit.name,
      session: c.order.session,
      date: c.order.date,
      consumed: c.consumedQty,
      verifiedAt: c.verifiedAt,
      // Frozen at approval — see amountFor().
      amount: c.amount,
    }));
  });

  // What a close-out is worth: consumed plates x the dish's rate, falling back
  // to the blanket `ratePerPlate` setting for any dish without its own.
  //
  // Only main items carry a ConsumptionItem, so accompaniments are never
  // charged — which matches how they are ordered, i.e. not at all.
  async function amountFor(orderId: number): Promise<number | null> {
    const cons = await prisma.consumption.findUnique({
      where: { orderId },
      include: { items: { include: { dish: true } } },
    });
    if (!cons) return null;
    const setting = await prisma.setting.findUnique({ where: { key: "ratePerPlate" } });
    const fallback = Number(setting?.value ?? 0) || 0;
    const total = cons.items.reduce(
      (sum, it) => sum + it.consumed * (it.dish.ratePerPlate ?? fallback),
      0
    );
    return Math.round(total * 100) / 100;
  }

  // Verification (verification admin) -> closes the order and unlocks reorder.
  app.post<{ Body: { orderId: number; verifiedBy?: number; approve: boolean; reason?: string } }>(
    "/orders/verify",
    { preHandler: requireRole("VERIFICATION_ADMIN") },
    async (req, reply) => {
      const { orderId, approve } = req.body;
      const reason = (req.body.reason ?? "").trim();
      // Who verified is taken from the signed-in session. It used to come from
      // the request body, so any caller could attribute a verification to
      // anyone — or to a user id that did not exist.
      const verifiedBy = must(req).userId;
      const cons = await prisma.consumption.findUnique({ where: { orderId } });
      if (!cons) return reply.code(404).send({ error: "No consumption submitted yet." });

      // Returning a close-out without saying why leaves the booker guessing at
      // what to change, so the reason is required on a rejection.
      if (!approve && reason.length < 3)
        return reply.code(422).send({ error: "Say why it is being returned, so the booker knows what to fix." });

      const amount = approve ? await amountFor(orderId) : null;

      await prisma.consumption.update({
        where: { orderId },
        data: {
          status: approve ? "VERIFIED" : "REJECTED",
          verifiedBy,
          verifiedAt: new Date(),
          rejectionReason: approve ? null : reason,
          ...(approve ? { amount } : {}),
        },
      });
      // Approving no longer closes the order. Feedback is the last step, and
      // it is what closes it — see POST /orders/feedback.
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { unit: true, feedback: true },
      });
      if (approve && order?.feedback)
        await prisma.order.update({ where: { id: orderId }, data: { status: "CLOSED" } });
      if (order?.bookedById) {
        const where = `${order.unit.name} · ${SES_LABEL[order.session] ?? order.session}`;
        await notifyUsers([order.bookedById], approve
          ? {
              type: "VERIFIED",
              title: "Consumption verified ✓",
              body: `${where} — one step left: tell us how the food was, then you can book again.`,
              section: "close",
              orderId,
            }
          : { type: "REJECTED", title: "Close-out returned", body: `${where} — ${reason}`, section: "close", orderId });
      }
      return { ok: true, amount };
    }
  );
}
