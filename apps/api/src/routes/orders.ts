import type { FastifyInstance } from "fastify";
import { prisma } from "@sk/db";
import { canPlaceOrder, type Session as Sess } from "@sk/logic";
import { notifyRoles, notifyUsers } from "../notify.js";
import { must, requireAuth, requireRole } from "../guard.js";
import { dayRange } from "../time.js";
import { expandSlots, menuFor } from "../menu.js";

const SES_LABEL: Record<string, string> = { BREAKFAST: "Tiffin", LUNCH: "Lunch", DINNER: "Dinner" };

export default async function orderRoutes(app: FastifyInstance) {
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
      const slots = await menuFor(new Date(req.query.date), req.query.session);
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

  // Whether a unit may still place its next order (reorder gate).
  app.get<{ Params: { unitId: string } }>("/units/:unitId/can-order", { preHandler: requireAuth }, async (req) => {
    const unitId = Number(req.params.unitId);
    // Find the most recent non-closed order for this unit.
    const open = await prisma.order.findFirst({
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
  });

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
      needsCloseOut: !o.consumption || !o.feedback || o.consumption.status === "REJECTED",
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
    const forDate = new Date(b.date);
    const check = canPlaceOrder(b.session, new Date(), forDate, b.isEmergency);
    if (!check.allowed) return reply.code(422).send({ error: check.reason });

    // One order per booker, per meal, per day. Applies whether the booker chose
    // a route or left it on auto — choosing a route changes WHERE the order
    // goes, not how many a person may place. Emergency orders are exempt.
    //
    // Two separate limits are in play and both matter:
    //   this one      — one person cannot book the same meal twice in a day
    //   the DB index  — one route holds at most one order per date+session
    if (!b.isEmergency) {
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
    // one must be closed out.
    if (!b.isEmergency) {
      const blocked = await blockingOrder(bookedById, b.session);
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
          peopleCount: b.peopleCount,
          totalPlates: finalItems.length ? totalPlates : b.peopleCount ?? null,
          items: finalItems.length
            ? { create: finalItems.map((it) => ({ dishId: it.dishId, plates: it.plates })) }
            : undefined,
        },
        include: { items: true, unit: true },
      });
      const after = await coverage(forDate, b.session);
      // Notify kitchen + super admin that a new order came in.
      await notifyRoles(["KITCHEN_ADMIN", "SUPER_ADMIN"], {
        type: "ORDER_PLACED",
        title: "New booking",
        body: `${chosenUnit.name} · ${SES_LABEL[b.session] ?? b.session} · ${order.totalPlates ?? 0} plates`,
        section: "orders",
        orderId: order.id,
      });
      return { ...order, assignedUnit: chosenUnit.name, booked: after.booked, total: after.total };
    } catch (e: any) {
      if (e.code === "P2002")
        return reply.code(409).send({ error: "That kitchen is already booked for this session." });
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
    async (req) => coverage(new Date(req.query.date), req.query.session)
  );

  // Recent orders across all kitchens.
  //
  // This returns EVERY booker's orders, not just the caller's — the kitchen and
  // admin screens want the whole picture. The row therefore carries who placed
  // it, so a client showing "My Bookings" can filter, and so the booking screen
  // can offer to repeat the caller's OWN last order rather than a stranger's.
  app.get("/bookings/recent", { preHandler: requireAuth }, async (req) => {
    const me = must(req).userId;
    const orders = await prisma.order.findMany({
      include: { unit: true, items: { include: { dish: true } }, consumption: true, feedback: true },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: 60,
    });
    return orders.map((o) => ({
      id: o.id,
      unit: o.unit.name,
      date: o.date,
      session: o.session,
      isEmergency: o.isEmergency,
      peopleCount: o.peopleCount,
      totalPlates: o.totalPlates,
      items: o.items.map((it) => ({ dish: it.dish.name, plates: it.plates })),
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
      needsCloseOut:
        !o.consumption || !o.feedback || o.consumption.status === "REJECTED",
      bookedById: o.bookedById,
      mine: o.bookedById === me,
    }));
  });

  // List orders for a date (+ optional session), with line items.
  app.get<{ Querystring: { date: string; session?: string } }>(
    "/orders",
    { preHandler: requireAuth },
    async (req) => {
    const { date, session } = req.query;
    return prisma.order.findMany({
      where: {
        date: dayRange(date),
        ...(session ? { session: session as any } : {}),
      },
      include: { unit: true, items: { include: { dish: true } } },
      orderBy: { unitId: "asc" },
    });
  });

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
      const day = new Date(req.body.date);
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
