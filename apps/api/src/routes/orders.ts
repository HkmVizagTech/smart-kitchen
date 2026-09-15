import type { FastifyInstance } from "fastify";
import { prisma } from "@sk/db";
import { canPlaceOrder, type Session as Sess } from "@sk/logic";
import { notifyRoles, notifyUsers } from "../notify.js";
import { must, requireAuth, requireRole } from "../guard.js";
import { dayRange } from "../time.js";

const SES_LABEL: Record<string, string> = { BREAKFAST: "Tiffin", LUNCH: "Lunch", DINNER: "Dinner" };

export default async function orderRoutes(app: FastifyInstance) {
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
    const needs: string[] = [];
    if (open.status !== "DELIVERED" && !open.consumption) needs.push("await delivery");
    if (!open.consumption) needs.push("submit consumption");
    if (!open.feedback) needs.push("submit feedback");
    if (open.consumption && open.consumption.status !== "VERIFIED") needs.push("await verification");
    return {
      canOrder: needs.length === 0,
      reason: needs.join(" + ") || "Ready.",
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
      status: o.status,
      hasConsumption: !!o.consumption,
      hasFeedback: !!o.feedback,
      consumptionStatus: o.consumption?.status ?? null,
      needsCloseOut: !o.consumption || !o.feedback,
    }));
  });

  // Place an order. The kitchen is auto-assigned to the next free section for
  // this date+session (one order per kitchen). Tiffin/dinner: items=[{dishId,plates}].
  app.post<{
    Body: {
      date: string;
      session: Sess;
      isEmergency?: boolean;
      bookedById?: number;
      items?: { dishId: number; plates: number }[];
      peopleCount?: number;
    };
  }>("/orders", { preHandler: requireRole("BOOKING") }, async (req, reply) => {
    const b = req.body;
    // The booker is whoever is signed in — never a user id sent in the body.
    const bookedById = must(req).userId;
    const forDate = new Date(b.date);
    const check = canPlaceOrder(b.session, new Date(), forDate, b.isEmergency);
    if (!check.allowed) return reply.code(422).send({ error: check.reason });

    // One order per booker per meal per day (emergency has no limit).
    if (!b.isEmergency) {
      const dup = await prisma.order.findFirst({
        where: {
          bookedById,
          session: b.session,
          isEmergency: false,
          date: dayRange(b.date),
        },
      });
      if (dup)
        return reply
          .code(409)
          .send({ error: `You have already booked ${b.session.toLowerCase()} for this day.` });
    }

    // Auto-assign to the next kitchen (Unit-1…Others) that has no order yet
    // for this date+session.
    const cov = await coverage(forDate, b.session);
    const freeUnit = cov.units.find((u) => !u.booked);
    if (!freeUnit)
      return reply
        .code(409)
        .send({ error: `All ${cov.total} kitchens are already booked for this ${b.session.toLowerCase()}.` });
    const assignedUnitId = freeUnit.id;

    // Booker's entered items (accompaniments are ignored if sent — derived below).
    const allDishes = await prisma.dish.findMany({ where: { bookable: true } });
    const byId = new Map(allDishes.map((d) => [d.id, d]));
    const entered = (b.items ?? [])
      .filter((it) => it.dishId && it.plates > 0)
      .filter((it) => !byId.get(it.dishId)?.accompaniment);

    if (b.session !== "LUNCH" && !b.isEmergency && entered.length === 0)
      return reply.code(422).send({ error: "Add at least one dish with a plate count." });

    // Accompaniment plates = sum of Item 1 + Item 3 solid (non-accompaniment) plates.
    const solidTotal = entered.reduce((a, it) => {
      const g = byId.get(it.dishId)?.group;
      return g === "ITEM1" || g === "ITEM3" ? a + it.plates : a;
    }, 0);
    const accDishes = allDishes.filter((d) => d.accompaniment);
    const derived =
      solidTotal > 0 ? accDishes.map((d) => ({ dishId: d.id, plates: solidTotal })) : [];

    const finalItems = [...entered, ...derived];
    const totalPlates = entered.reduce((a, it) => a + it.plates, 0); // booker plates (no double-count)

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
        body: `${freeUnit.name} · ${SES_LABEL[b.session] ?? b.session} · ${order.totalPlates ?? 0} plates`,
        section: "orders",
        orderId: order.id,
      });
      return { ...order, assignedUnit: freeUnit.name, booked: after.booked, total: after.total };
    } catch (e: any) {
      if (e.code === "P2002")
        return reply.code(409).send({ error: "That kitchen is already booked for this session." });
      throw e;
    }
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

  // Recent orders across all kitchens (for the booker's "My Bookings").
  app.get("/bookings/recent", { preHandler: requireAuth }, async () => {
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
      needsCloseOut: !o.consumption || !o.feedback,
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
      include: { items: { include: { dish: true } }, unit: true },
    });
    if (!order) return reply.code(404).send({ error: "Order not found." });
    const items = order.items
      .filter((it) => !it.dish.accompaniment)
      .map((it) => ({ dishId: it.dishId, name: it.dish.name, ordered: it.plates }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { orderId: order.id, unit: order.unit.name, session: order.session, items };
  });

  // Submit consumption (per main item) + mandatory feedback.
  app.post<{
    Body: {
      orderId: number;
      items: { dishId: number; consumed: number }[];
      notes?: string;
      taste: number;
      quality: number;
      remarks?: string;
    };
  }>("/orders/consumption", { preHandler: requireRole("BOOKING") }, async (req, reply) => {
    const b = req.body;
    if (!b.taste || !b.quality)
      return reply.code(422).send({ error: "Feedback (taste + quality) is mandatory." });

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
        update: { receivedQty, consumedQty, leftoverQty, notes: b.notes, status: "PENDING" },
        create: { orderId: b.orderId, receivedQty, consumedQty, leftoverQty, notes: b.notes },
      });
      await tx.consumptionItem.createMany({
        data: rows.map((r) => ({ consumptionId: cons.id, dishId: r.dishId, ordered: r.ordered, consumed: r.consumed })),
      });
      await tx.feedback.upsert({
        where: { orderId: b.orderId },
        update: { taste: b.taste, quality: b.quality, remarks: b.remarks },
        create: { orderId: b.orderId, taste: b.taste, quality: b.quality, remarks: b.remarks },
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
        order: { include: { unit: true, feedback: true } },
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
      taste: c.order.feedback?.taste ?? null,
      quality: c.order.feedback?.quality ?? null,
      remarks: c.order.feedback?.remarks ?? null,
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
    }));
  });

  // Verification (verification admin) -> closes the order and unlocks reorder.
  app.post<{ Body: { orderId: number; verifiedBy?: number; approve: boolean } }>(
    "/orders/verify",
    { preHandler: requireRole("VERIFICATION_ADMIN") },
    async (req, reply) => {
      const { orderId, approve } = req.body;
      // Who verified is taken from the signed-in session. It used to come from
      // the request body, so any caller could attribute a verification to
      // anyone — or to a user id that did not exist.
      const verifiedBy = must(req).userId;
      const cons = await prisma.consumption.findUnique({ where: { orderId } });
      if (!cons) return reply.code(404).send({ error: "No consumption submitted yet." });
      await prisma.consumption.update({
        where: { orderId },
        data: { status: approve ? "VERIFIED" : "REJECTED", verifiedBy, verifiedAt: new Date() },
      });
      if (approve) await prisma.order.update({ where: { id: orderId }, data: { status: "CLOSED" } });
      // Notify the booker of the verification outcome.
      const order = await prisma.order.findUnique({ where: { id: orderId }, include: { unit: true } });
      if (order?.bookedById) {
        const where = `${order.unit.name} · ${SES_LABEL[order.session] ?? order.session}`;
        await notifyUsers([order.bookedById], approve
          ? { type: "VERIFIED", title: "Meal verified ✓", body: `${where} is verified and closed. You can place your next order.`, section: "mine", orderId }
          : { type: "REJECTED", title: "Close-out returned", body: `${where} close-out was returned — please review and resubmit.`, section: "close", orderId });
      }
      return { ok: true };
    }
  );
}
