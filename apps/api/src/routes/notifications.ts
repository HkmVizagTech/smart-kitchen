import type { FastifyInstance } from "fastify";
import { prisma } from "@sk/db";
import { must, requireAuth } from "../guard.js";

// Everything here is scoped to the signed-in user's own notifications.
export default async function notificationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  // Latest notifications for the signed-in user.
  app.get("/notifications", async (req, reply) => {
    const s = must(req);
    return prisma.notification.findMany({
      where: { userId: s.userId },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
  });

  // Unread count + per-section unread counts (for the bell badge + tab dots).
  app.get("/notifications/summary", async (req, reply) => {
    const s = must(req);
    const unread = await prisma.notification.findMany({
      where: { userId: s.userId, read: false },
      select: { section: true },
    });
    const sections: Record<string, number> = {};
    for (const n of unread) sections[n.section] = (sections[n.section] ?? 0) + 1;
    return { unread: unread.length, sections };
  });

  // Mark one as read.
  app.post<{ Params: { id: string } }>("/notifications/:id/read", async (req, reply) => {
    const s = must(req);
    await prisma.notification.updateMany({
      where: { id: Number(req.params.id), userId: s.userId },
      data: { read: true },
    });
    return { ok: true };
  });

  // Mark all read (optionally just one section).
  app.post<{ Body: { section?: string } }>("/notifications/read-all", async (req, reply) => {
    const s = must(req);
    await prisma.notification.updateMany({
      where: { userId: s.userId, read: false, ...(req.body?.section ? { section: req.body.section } : {}) },
      data: { read: true },
    });
    return { ok: true };
  });
}
