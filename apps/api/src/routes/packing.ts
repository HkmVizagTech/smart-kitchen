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
      // Always return what has been booked so far. The kitchen watches this
      // screen fill up during the evening; hiding it until the last route books
      // meant staring at a placeholder with no idea who was missing.
      const cov = await coverage(new Date(date), session);
      const sheet = await computeSession(new Date(date), session);
      return { ready: cov.ready, booked: cov.booked, total: cov.total, missing: cov.missing, sheet };
    }
  );

  // Download the Excel — blocked until every kitchen for the day is booked.
  //
  // This one is opened as a plain link, and a browser navigation cannot send an
  // Authorization header, so the guard also accepts `?token=` (see guard.ts).
  app.get<{ Querystring: { date: string; token?: string; force?: string } }>(
    "/packing/excel",
    kitchenOnly,
    async (req, reply) => {
      const date = new Date(req.query.date);
      const bf = await coverage(date, "BREAKFAST");
      const dn = await coverage(date, "DINNER");
      // The kitchen can pull the sheet early — a route that has not booked by
      // cooking time is a real situation, and a sheet missing one row beats no
      // sheet at all. The workbook says so in its header when that happens.
      const force = req.query.force === "1";
      if (!bf.ready && !dn.ready && !force)
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
