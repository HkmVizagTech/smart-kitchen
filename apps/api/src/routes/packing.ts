import type { FastifyInstance } from "fastify";
import { computeSession, buildWorkbook, coverage, deliveryNotes, type DeliveryNote } from "../packingService.js";
import { requireRole } from "../guard.js";
import { requireYmd } from "../time.js";

export default async function packingRoutes(app: FastifyInstance) {
  // Kitchen and Super Admin only — this is the day's full production plan.
  const kitchenOnly = { preHandler: requireRole("KITCHEN_ADMIN") };

  // JSON breakdown for a date + session. Only "ready" once all kitchens are booked.
  app.get<{ Querystring: { date: string; session: "BREAKFAST" | "LUNCH" | "DINNER" } }>(
    "/packing/preview",
    kitchenOnly,
    async (req) => {
      const { session } = req.query;
      const date = requireYmd(req.query.date);
      // Always return what has been booked so far. The kitchen watches this
      // screen fill up during the evening; hiding it until the last route books
      // meant staring at a placeholder with no idea who was missing.
      const cov = await coverage(date, session);
      const sheet = await computeSession(date, session);
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
      const date = requireYmd(req.query.date);
      const bf = await coverage(date, "BREAKFAST");
      const dn = await coverage(date, "DINNER");
      // Lunch is same-day and booked right up to the cutoff, so it is never
      // used to hold the sheet back — it just appears on it once booked.
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

  /**
   * Printable delivery notes — one page per route, to travel with the food.
   *
   * The packing sheet is one wide grid covering every route at once: right for
   * the kitchen, useless on a van. This is the same figures cut the other way.
   * Served as a printable page rather than a download, so the kitchen opens it
   * and presses print; like the Excel it is opened as a plain link, so it takes
   * ?token= too.
   */
  app.get<{ Querystring: { date: string; session?: string; token?: string } }>(
    "/packing/delivery-notes",
    kitchenOnly,
    async (req, reply) => {
      const date = requireYmd(req.query.date);
      const sessions: ("BREAKFAST" | "LUNCH" | "DINNER")[] =
        req.query.session === "BREAKFAST" || req.query.session === "LUNCH" || req.query.session === "DINNER"
          ? [req.query.session]
          : ["BREAKFAST", "LUNCH", "DINNER"];

      const blocks: string[] = [];
      for (const session of sessions) {
        for (const note of await deliveryNotes(date, session)) blocks.push(renderNote(note));
      }
      const when = date.toLocaleDateString("en-GB", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
      });
      reply
        .header("Content-Type", "text/html; charset=utf-8")
        .send(notePage(
          blocks.length
            ? blocks.join("\n")
            : `<article class="note"><p>No orders for ${esc(when)}.</p></article>`,
          when
        ));
    }
  );
}

// ------------------------------------------------------- note rendering
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const SES_TITLE: Record<string, string> = {
  BREAKFAST: "Morning Tiffin", LUNCH: "Lunch", DINNER: "Dinner",
};

function renderNote(n: DeliveryNote): string {
  const rows = n.lines
    .map(
      (l) => `
      <tr>
        <td class="d">${esc(l.dish)}</td>
        <td class="q">${l.qty} ${l.unit}</td>
        <td class="c">${esc(l.cans)}</td>
        <td class="tick"></td>
      </tr>`
    )
    .join("");
  const when = n.date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return `
  <article class="note">
    <header>
      <div>
        <div class="route">${esc(n.unit)}</div>
        <div class="meal">${esc(SES_TITLE[n.session] ?? n.session)} · ${esc(when)}</div>
      </div>
      <div class="plates"><span>${n.totalPlates}</span>plates</div>
    </header>
    <table>
      <thead><tr><th>Dish</th><th>Quantity</th><th>Cans</th><th class="tick">Loaded</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <footer>
      <div class="sig"><span></span>Packed by</div>
      <div class="sig"><span></span>Received by</div>
    </footer>
  </article>`;
}

function notePage(body: string, when: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Delivery notes — ${esc(when)}</title>
<style>
  @page { size: A5 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Helvetica, Arial, sans-serif; color: #112d4e; background: #dbe2ef; }
  .bar { padding: 12px 18px; background: #fff; border-bottom: 1px solid #c9d4e4; font-size: 13px; }
  .bar button { font: inherit; font-weight: 700; cursor: pointer; border: none; border-radius: 8px;
                background: #3f72af; color: #fff; padding: 7px 15px; margin-right: 10px; }
  .note { background: #fff; padding: 16px 18px; margin: 14px auto; max-width: 190mm;
          border-radius: 8px; page-break-after: always; }
  .note:last-child { page-break-after: auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid #112d4e; padding-bottom: 9px; margin-bottom: 4px; }
  .route { font-size: 21px; font-weight: 800; letter-spacing: -.3px; }
  .meal { font-size: 12px; color: #5a6f8d; margin-top: 2px; }
  .plates { text-align: right; font-size: 10px; color: #5a6f8d; text-transform: uppercase; letter-spacing: 1px; }
  .plates span { display: block; font-size: 25px; font-weight: 800; color: #112d4e; letter-spacing: -.5px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12.5px; }
  th { text-align: left; font-size: 8.5px; text-transform: uppercase; letter-spacing: .8px;
       color: #5a6f8d; padding: 6px; border-bottom: 1px solid #c9d4e4; }
  td { padding: 7px 6px; border-bottom: 1px solid #edf1f7; }
  td.d { font-weight: 600; }
  td.q, td.c { font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.q { font-weight: 700; }
  td.c { color: #3f72af; }
  th.tick, td.tick { width: 48px; text-align: center; }
  td.tick::after { content: ""; display: inline-block; width: 15px; height: 15px;
                   border: 1.5px solid #9fb3cd; border-radius: 3px; }
  footer { display: flex; gap: 34px; margin-top: 20px; }
  .sig { flex: 1; font-size: 9.5px; color: #5a6f8d; text-transform: uppercase; letter-spacing: .8px; }
  .sig span { display: block; border-bottom: 1px solid #9fb3cd; height: 26px; margin-bottom: 4px; }
  @media print {
    .bar { display: none; }
    body { background: #fff; }
    .note { margin: 0; max-width: none; border-radius: 0; padding: 0; }
  }
</style></head><body>
<div class="bar"><button onclick="window.print()">Print all</button>One page per route — ${esc(when)}</div>
${body}
</body></html>`;
}
