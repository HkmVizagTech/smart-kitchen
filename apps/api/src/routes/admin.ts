import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { prisma } from "@sk/db";
import { requireRole } from "../guard.js";
import { addDays, dayRange, localYmd } from "../time.js";

const ROLES = ["BOOKING", "KITCHEN_ADMIN", "VERIFICATION_ADMIN", "SUPER_ADMIN"];
const publicUser = (u: any) => ({
  id: u.id, name: u.name, role: u.role, username: u.username, email: u.email,
  phone: u.phone, photo: u.photo, iskconRole: u.iskconRole, centre: u.centre,
  address: u.address, active: u.active, deletedAt: u.deletedAt, createdAt: u.createdAt,
});
const norm = (s?: string | null) => (s ? s.trim() : null);

// Super Admin CRUD. Every route in this file is Super Admin only — the guard is
// registered once as a hook on this plugin scope so a newly added route cannot
// accidentally ship unprotected.
export default async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireRole("SUPER_ADMIN"));

  // ---- DISHES (edit quantities + packing factors) ----
  app.get("/admin/dishes", async () => prisma.dish.findMany({ orderBy: { id: "asc" } }));

  app.put<{
    Params: { id: string };
    Body: {
      qtyPerPlate?: number;
      unit?: "NOS" | "G";
      packingFactor?: number;
      packingVesselKg?: number | null;
      group?: "ITEM1" | "ITEM2" | "ITEM3";
      bookable?: boolean;
    };
  }>("/admin/dishes/:id", async (req) => {
    const id = Number(req.params.id);
    const b = req.body;
    return prisma.dish.update({
      where: { id },
      data: {
        qtyPerPlate: b.qtyPerPlate,
        unit: b.unit,
        packingFactor: b.packingFactor,
        packingVesselKg: b.packingVesselKg,
        group: b.group,
        bookable: b.bookable,
      },
    });
  });

  // Add a new dish.
  app.post<{
    Body: { name: string; group: "ITEM1" | "ITEM2" | "ITEM3"; qtyPerPlate?: number; unit?: "NOS" | "G"; packingFactor?: number; packingVesselKg?: number | null };
  }>("/admin/dishes", async (req, reply) => {
    try {
      return await prisma.dish.create({
        data: {
          name: req.body.name,
          group: req.body.group,
          qtyPerPlate: req.body.qtyPerPlate ?? 0,
          unit: req.body.unit ?? "G",
          packingFactor: req.body.packingFactor ?? 0,
          packingVesselKg: req.body.packingVesselKg ?? null,
        },
      });
    } catch {
      return reply.code(409).send({ error: "A dish with that name already exists." });
    }
  });

  // ---- UNITS ----
  app.get("/admin/units", async () => prisma.unit.findMany({ orderBy: { id: "asc" } }));

  app.post<{ Body: { name: string; memberCount?: number; isOptional?: boolean } }>(
    "/admin/units",
    async (req) =>
      prisma.unit.create({
        data: {
          name: req.body.name,
          memberCount: req.body.memberCount ?? 0,
          isOptional: req.body.isOptional ?? false,
        },
      })
  );

  app.put<{ Params: { id: string }; Body: { name?: string; memberCount?: number; isOptional?: boolean } }>(
    "/admin/units/:id",
    async (req) =>
      prisma.unit.update({
        where: { id: Number(req.params.id) },
        data: req.body,
      })
  );

  // ---- USERS (profiles + roles + lifecycle) ----
  // List users. Archived (soft-deleted) hidden unless ?includeDeleted=1.
  app.get<{ Querystring: { includeDeleted?: string } }>("/admin/users", async (req) => {
    const includeDeleted = req.query.includeDeleted === "1";
    const users = await prisma.user.findMany({
      where: includeDeleted ? {} : { deletedAt: null },
      orderBy: { id: "asc" },
    });
    return users.map(publicUser);
  });

  // Create a user directly (Super Admin). Admin sets the initial password.
  app.post<{
    Body: {
      role: string; username: string; password: string; name: string;
      email?: string; phone?: string; iskconRole?: string; centre?: string; address?: string;
    };
  }>("/admin/users", async (req, reply) => {
    const b = req.body;
    if (!b.username || !b.password || !b.name || !b.role)
      return reply.code(422).send({ error: "Name, role, username and a temporary password are required." });
    if (!ROLES.includes(b.role)) return reply.code(422).send({ error: "Unknown role." });
    // Same minimum as self-signup — an admin-created account should not be the
    // weaker path into the system.
    if (b.password.length < 8)
      return reply.code(422).send({ error: "Password must be at least 8 characters." });
    try {
      const u = await prisma.user.create({
        data: {
          role: b.role as any,
          username: b.username.trim().toLowerCase(),
          passwordHash: await bcrypt.hash(b.password, 10),
          name: b.name.trim(),
          email: norm(b.email)?.toLowerCase() || null,
          phone: norm(b.phone),
          iskconRole: norm(b.iskconRole),
          centre: norm(b.centre),
          address: norm(b.address),
        },
      });
      return reply.code(201).send(publicUser(u));
    } catch (e: any) {
      if (e.code === "P2002") {
        const f = e.meta?.target?.[0] ?? "username/email/phone";
        return reply.code(409).send({ error: `That ${f} is already in use.` });
      }
      throw e;
    }
  });

  // Edit profile / role / active (not password).
  app.put<{
    Params: { id: string };
    Body: { name?: string; role?: any; email?: string | null; phone?: string | null; iskconRole?: string | null; centre?: string | null; address?: string | null; active?: boolean };
  }>("/admin/users/:id", async (req, reply) => {
    const b = req.body;
    try {
      const u = await prisma.user.update({
        where: { id: Number(req.params.id) },
        data: {
          name: b.name?.trim(),
          role: b.role,
          email: b.email !== undefined ? (norm(b.email)?.toLowerCase() || null) : undefined,
          phone: b.phone !== undefined ? norm(b.phone) : undefined,
          iskconRole: b.iskconRole !== undefined ? norm(b.iskconRole) : undefined,
          centre: b.centre !== undefined ? norm(b.centre) : undefined,
          address: b.address !== undefined ? norm(b.address) : undefined,
          active: b.active,
        },
      });
      return publicUser(u);
    } catch (e: any) {
      if (e.code === "P2002") {
        const f = e.meta?.target?.[0] ?? "field";
        return reply.code(409).send({ error: `That ${f} is already in use.` });
      }
      throw e;
    }
  });

  // Reset a user's password (Super Admin sets a new one).
  app.post<{ Params: { id: string }; Body: { password: string } }>(
    "/admin/users/:id/reset-password",
    async (req, reply) => {
      if (!req.body.password || req.body.password.length < 8)
        return reply.code(422).send({ error: "Password must be at least 8 characters." });
      await prisma.user.update({
        where: { id: Number(req.params.id) },
        data: { passwordHash: await bcrypt.hash(req.body.password, 10) },
      });
      return { ok: true };
    }
  );

  // Deactivate / reactivate.
  app.post<{ Params: { id: string }; Body: { active: boolean } }>(
    "/admin/users/:id/active",
    async (req) => publicUser(await prisma.user.update({ where: { id: Number(req.params.id) }, data: { active: req.body.active } }))
  );

  // Soft-delete: hide from lists + block sign-in, but keep order history intact.
  app.delete<{ Params: { id: string } }>("/admin/users/:id", async (req, reply) => {
    const id = Number(req.params.id);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || user.deletedAt) return reply.code(404).send({ error: "User not found." });
    if (user.role === "SUPER_ADMIN") {
      const others = await prisma.user.count({ where: { role: "SUPER_ADMIN", deletedAt: null, id: { not: id } } });
      if (others === 0) return reply.code(409).send({ error: "Cannot remove the last Super Admin." });
    }
    await prisma.user.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    return { ok: true };
  });

  // Restore an archived (soft-deleted) user.
  app.post<{ Params: { id: string } }>("/admin/users/:id/restore", async (req) =>
    publicUser(await prisma.user.update({ where: { id: Number(req.params.id) }, data: { deletedAt: null, active: true } }))
  );

  // ---- VESSEL SIZES ----
  app.get("/admin/vessels", async () =>
    prisma.vesselSize.findMany({ orderBy: [{ session: "asc" }, { size: "desc" }] })
  );

  app.post<{ Body: { session: "MORNING" | "EVENING"; size: number } }>(
    "/admin/vessels",
    async (req, reply) => {
      try {
        return await prisma.vesselSize.create({ data: req.body });
      } catch {
        return reply.code(409).send({ error: "That vessel size already exists for the session." });
      }
    }
  );

  app.delete<{ Params: { id: string } }>("/admin/vessels/:id", async (req) => {
    await prisma.vesselSize.delete({ where: { id: Number(req.params.id) } });
    return { ok: true };
  });

  // ---- DASHBOARD ----
  app.get("/admin/dashboard", async () => {
    // "Today" and "tomorrow" as seen from India, not from the container's UTC
    // clock — otherwise the dashboard shows the wrong day before 05:30 IST.
    const todayYmd = localYmd();
    const today = dayRange(todayYmd);
    const tomorrow = dayRange(addDays(todayYmd, 1));
    const totalKitchens = await prisma.unit.count();

    async function sessionCover(range: { gte: Date; lt: Date }, session: string) {
      const orders = await prisma.order.findMany({
        where: { date: range, session: session as any },
        select: { unitId: true, totalPlates: true, peopleCount: true },
      });
      const kitchens = new Set(orders.map((o) => o.unitId)).size;
      const plates = orders.reduce((a, o) => a + (o.totalPlates ?? o.peopleCount ?? 0), 0);
      return { booked: kitchens, total: totalKitchens, plates, orders: orders.length };
    }

    const [pending, usersCount, dishesCount] = await Promise.all([
      prisma.consumption.count({ where: { status: "PENDING" } }),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.dish.count({ where: { bookable: true } }),
    ]);
    const recent = await prisma.order.findMany({
      include: { unit: true },
      orderBy: [{ createdAt: "desc" }],
      take: 8,
    });

    return {
      tomorrow: {
        breakfast: await sessionCover(tomorrow, "BREAKFAST"),
        dinner: await sessionCover(tomorrow, "DINNER"),
      },
      today: { lunch: await sessionCover(today, "LUNCH") },
      pendingVerifications: pending,
      usersCount,
      dishesCount,
      totalKitchens,
      recent: recent.map((o) => ({
        id: o.id, unit: o.unit.name, session: o.session, status: o.status,
        plates: o.totalPlates ?? o.peopleCount ?? 0, date: o.date, createdAt: o.createdAt,
        isEmergency: o.isEmergency,
      })),
    };
  });

  // ---- REPORTS (verified consumption over a date range) ----
  app.get<{ Querystring: { from: string; to: string } }>("/admin/report", async (req) => {
    // Inclusive of both endpoints, in stored (UTC) day terms.
    const from = dayRange(req.query.from).gte;
    const to = dayRange(addDays(req.query.to, 1)).gte;
    const cons = await prisma.consumption.findMany({
      where: { status: "VERIFIED", order: { date: { gte: from, lt: to } } },
      include: { order: { include: { unit: true, feedback: true } } },
    });
    const perUnit: Record<string, { ordered: number; consumed: number; leftover: number; meals: number }> = {};
    let ordered = 0, consumed = 0, leftover = 0, tasteSum = 0, qualSum = 0, fb = 0;
    for (const c of cons) {
      const u = c.order.unit.name;
      perUnit[u] ??= { ordered: 0, consumed: 0, leftover: 0, meals: 0 };
      perUnit[u].ordered += c.receivedQty; perUnit[u].consumed += c.consumedQty;
      perUnit[u].leftover += c.leftoverQty; perUnit[u].meals += 1;
      ordered += c.receivedQty; consumed += c.consumedQty; leftover += c.leftoverQty;
      if (c.order.feedback) { tasteSum += c.order.feedback.taste; qualSum += c.order.feedback.quality; fb += 1; }
    }
    return {
      meals: cons.length,
      ordered, consumed, leftover,
      wastePct: ordered ? Math.round((leftover / ordered) * 1000) / 10 : 0,
      avgTaste: fb ? Math.round((tasteSum / fb) * 10) / 10 : 0,
      avgQuality: fb ? Math.round((qualSum / fb) * 10) / 10 : 0,
      perUnit: Object.entries(perUnit).map(([unit, v]) => ({
        unit, ...v, wastePct: v.ordered ? Math.round((v.leftover / v.ordered) * 1000) / 10 : 0,
      })),
    };
  });

  // ---- SETTINGS (key/value) ----
  app.get("/admin/settings", async () => {
    const rows = await prisma.setting.findMany();
    const out: Record<string, string> = {};
    rows.forEach((r) => (out[r.key] = r.value));
    return out;
  });
  app.put<{ Body: { key: string; value: string } }>("/admin/settings", async (req) => {
    const { key, value } = req.body;
    return prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  });
}
