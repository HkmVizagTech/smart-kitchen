import type { FastifyInstance } from "fastify";
import { computeSession, buildWorkbook, coverage } from "../packingService.js";
import { requireRole } from "../guard.js";

export default async function packingRoutes(app: FastifyInstance) {
  // Kitchen and Super Admin only — this is the day's full production plan.
  const kitchenOnly = { preHandler: requireRole("KITCHEN_ADMIN") };

  // JSON breakdown for a date + session. Only "ready" once all kitchens are booked.
  app.get<{ Querystring: { date: string; session: "BREAKFAST" | "DINNER" } }>(
    "/packing/preview",
    kitchenOnly,
    async (req) => {
      const { date, session } = req.query;
      const cov = await coverage(new Date(date), session);
      if (!cov.ready) return { ready: false, booked: cov.booked, total: cov.total, sheet: null };
      const sheet = await computeSession(new Date(date), session);
      return { ready: true, booked: cov.booked, total: cov.total, sheet };
    }
  );

  // Download the Excel — blocked until every kitchen for the day is booked.
  //
  // This one is opened as a plain link, and a browser navigation cannot send an
  // Authorization header, so the guard also accepts `?token=` (see guard.ts).
  app.get<{ Querystring: { date: string; token?: string } }>(
    "/packing/excel",
    kitchenOnly,
    async (req, reply) => {
      const date = new Date(req.query.date);
      const bf = await coverage(date, "BREAKFAST");
      const dn = await coverage(date, "DINNER");
      if (!bf.ready && !dn.ready)
        return reply.code(409).send({
          error: `Packing sheet generates only after all ${bf.total} kitchens are booked (tiffin ${bf.booked}/${bf.total}, dinner ${dn.booked}/${dn.total}).`,
        });
      const wb = await buildWorkbook(date);
      const buf = await wb.xlsx.writeBuffer();
      reply
        .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("Content-Disposition", `attachment; filename="packing_${req.query.date}.xlsx"`)
        .send(Buffer.from(buf));
    }
  );
}
