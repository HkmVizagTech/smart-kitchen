// Packing / Delivery Sheet — matches the "Brandix Delivery Sheet" layout exactly:
// logo + foundation header, an Indent block (per-dish plate counts) + Total, then
// a per-dish Qty + vessel-breakdown block, and a Total row. Two blocks per file
// (Morning tiffin, Evening dinner). Quantities computed from order line items.

import ExcelJS from "exceljs";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma, type Session, type VesselSession } from "@sk/db";
import { calcDish } from "@sk/logic";

interface DishInfo {
  id: number;
  name: string;
  packingFactor: number;
  packingVesselKg: number | null;
  group: string;
  sortOrder: number;
  accompaniment: boolean;
}

export interface PackingRow {
  unit: string;
  plates: Record<number, number>; // dishId -> ordered plates (non-accompaniment)
  totalPlates: number;
  cells: Record<string, { qty: number; vessels?: Record<number, number>; vesselCount?: number }>;
}

export interface SessionSheet {
  session: Session;
  vesselSession: VesselSession;
  vessels: number[];
  indentDishes: { id: number; name: string }[]; // main dishes booked (left block)
  dishOrder: { id: number; name: string; packingVesselKg: number | null }[]; // all dishes (right block)
  rows: PackingRow[];
}

const VESSEL_MAP: Record<string, VesselSession> = { BREAKFAST: "MORNING", DINNER: "EVENING" };

// How many of the kitchens have an order for this date+session.
export async function coverage(date: Date, session: Session) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const units = await prisma.unit.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } });
  const bookedIds = new Set(
    (
      await prisma.order.findMany({
        where: { date: { gte: start, lt: end }, session },
        distinct: ["unitId"],
        select: { unitId: true },
      })
    ).map((o) => o.unitId)
  );
  const missing = units.filter((u) => !bookedIds.has(u.id)).map((u) => u.name);
  const total = units.length;
  const booked = total - missing.length;
  return { total, booked, missing, ready: missing.length === 0 && total > 0 };
}

export async function computeSession(date: Date, session: Session): Promise<SessionSheet | null> {
  if (session === "LUNCH") return null;
  const vesselSession = VESSEL_MAP[session];
  const vessels = (
    await prisma.vesselSize.findMany({ where: { session: vesselSession }, orderBy: { size: "desc" } })
  ).map((v) => v.size);

  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const orders = await prisma.order.findMany({
    where: { date: { gte: start, lt: end }, session },
    include: { unit: true, items: { include: { dish: true } } },
    orderBy: { unitId: "asc" },
  });

  const seen = new Map<number, DishInfo>();
  for (const o of orders)
    for (const it of o.items)
      if (!seen.has(it.dishId))
        seen.set(it.dishId, {
          id: it.dish.id,
          name: it.dish.name,
          packingFactor: it.dish.packingFactor,
          packingVesselKg: it.dish.packingVesselKg,
          group: it.dish.group,
          sortOrder: it.dish.sortOrder,
          accompaniment: it.dish.accompaniment,
        });
  const dishOrder = [...seen.values()].sort(
    (a, b) => a.group.localeCompare(b.group) || a.sortOrder - b.sortOrder
  );
  const indentDishes = dishOrder.filter((d) => !d.accompaniment);

  const rows: PackingRow[] = [];
  for (const o of orders) {
    const platesById = new Map<number, number>();
    for (const it of o.items) platesById.set(it.dishId, (platesById.get(it.dishId) ?? 0) + it.plates);

    const plates: Record<number, number> = {};
    let total = 0;
    for (const d of indentDishes) {
      const p = platesById.get(d.id) ?? 0;
      if (p > 0) { plates[d.id] = p; total += p; }
    }

    const cells: PackingRow["cells"] = {};
    for (const d of dishOrder) {
      const p = platesById.get(d.id) ?? 0;
      if (p === 0) continue;
      const res = calcDish({
        name: d.name,
        kind: d.packingVesselKg == null ? "count" : "weight",
        packingFactor: d.packingFactor,
        vesselKg: d.packingVesselKg ?? undefined,
        plates: p,
        vessels,
      });
      cells[d.name] = { qty: res.qty, vessels: res.vessels, vesselCount: res.vesselCount };
    }
    rows.push({ unit: o.unit.name, plates, totalPlates: total, cells });
  }

  return {
    session,
    vesselSession,
    vessels,
    indentDishes: indentDishes.map((d) => ({ id: d.id, name: d.name })),
    dishOrder: dishOrder.map((d) => ({ id: d.id, name: d.name, packingVesselKg: d.packingVesselKg })),
    rows,
  };
}

// ---------------------------------------------------------------- EXCEL
const THIN = { style: "thin" as const, color: { argb: "FF999999" } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE8D8" } };
const GRP_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3E2D0" } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFE3D3" } };
const CTR: Partial<ExcelJS.Alignment> = { horizontal: "center", vertical: "middle", wrapText: true };

function loadLogo(): Buffer | null {
  try {
    const p = fileURLToPath(new URL("../assets/logo.jpg", import.meta.url));
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  } catch {
    return null;
  }
}

function renderBlock(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  startRow: number,
  title: string,
  dateStr: string,
  sheet: SessionSheet,
  logoId: number | null
): number {
  const I = sheet.indentDishes.length;
  // column map (1-indexed)
  const C_SNO = 1, C_ROUTE = 2;
  const C_INDENT0 = 3; // first indent dish col
  const C_TOTAL = C_INDENT0 + I;
  let col = C_TOTAL + 1;
  const dishCols = sheet.dishOrder.map((d) => {
    const width = 1 + (d.packingVesselKg == null ? sheet.vessels.length : 1);
    const block = { d, c0: col, c1: col + width - 1 };
    col += width;
    return block;
  });
  const lastCol = col - 1;

  const put = (r: number, c: number, v: any, opts: { fill?: ExcelJS.Fill; bold?: boolean; red?: boolean } = {}) => {
    const cell = ws.getCell(r, c);
    cell.value = v;
    cell.border = BORDER;
    cell.alignment = CTR;
    cell.font = { name: "Arial", size: 9, bold: !!opts.bold, color: opts.red ? { argb: "FFC00000" } : undefined };
    if (opts.fill) cell.fill = opts.fill;
    return cell;
  };

  let r = startRow;
  // title rows (merged across cols 3..lastCol); logo over cols 1..2
  ws.mergeCells(r, 3, r, lastCol);
  put(r, 3, "Touch Stone Foundation - Vishakhapatnam", { bold: true });
  ws.mergeCells(r + 1, 3, r + 1, lastCol);
  put(r + 1, 3, title, { bold: true });
  ws.mergeCells(r + 2, 3, r + 2, lastCol);
  put(r + 2, 3, dateStr, { bold: true });
  if (logoId != null) {
    ws.addImage(logoId, { tl: { col: 0.2, row: startRow - 0.8 } as any, ext: { width: 150, height: 42 } });
  }
  const headRow1 = r + 3;
  const headRow2 = r + 4;

  // S.No / Route / Total span both header rows
  ws.mergeCells(headRow1, C_SNO, headRow2, C_SNO); put(headRow1, C_SNO, "S.No", { bold: true, fill: HEAD_FILL });
  ws.mergeCells(headRow1, C_ROUTE, headRow2, C_ROUTE); put(headRow1, C_ROUTE, "Route", { bold: true, fill: HEAD_FILL });
  ws.mergeCells(headRow1, C_TOTAL, headRow2, C_TOTAL); put(headRow1, C_TOTAL, "Total", { bold: true, fill: HEAD_FILL });
  // Indent group header
  if (I > 0) {
    ws.mergeCells(headRow1, C_INDENT0, headRow1, C_INDENT0 + I - 1);
    put(headRow1, C_INDENT0, "Indent (plates)", { bold: true, fill: GRP_FILL });
    sheet.indentDishes.forEach((d, i) => put(headRow2, C_INDENT0 + i, d.name, { bold: true, fill: HEAD_FILL }));
  }
  // dish group headers
  for (const { d, c0, c1 } of dishCols) {
    ws.mergeCells(headRow1, c0, headRow1, c1);
    put(headRow1, c0, d.name, { bold: true, fill: GRP_FILL });
    put(headRow2, c0, "Qty", { bold: true, fill: HEAD_FILL });
    if (d.packingVesselKg == null) {
      sheet.vessels.forEach((v, i) => put(headRow2, c0 + 1 + i, v, { bold: true, red: true, fill: HEAD_FILL }));
    } else {
      put(headRow2, c0 + 1, d.packingVesselKg, { bold: true, red: true, fill: HEAD_FILL });
    }
  }

  // data rows
  r = headRow2 + 1;
  const totals: Record<number, number> = {}; // colIndex -> sum
  const addTot = (c: number, v: number) => { totals[c] = (totals[c] ?? 0) + (v || 0); };
  sheet.rows.forEach((row, i) => {
    put(r, C_SNO, i + 1);
    put(r, C_ROUTE, row.unit, { bold: true });
    sheet.indentDishes.forEach((d, j) => { const v = row.plates[d.id] || null; put(r, C_INDENT0 + j, v); if (v) addTot(C_INDENT0 + j, v); });
    put(r, C_TOTAL, row.totalPlates || null, { bold: true }); addTot(C_TOTAL, row.totalPlates);
    for (const { d, c0 } of dishCols) {
      const c = row.cells[d.name];
      const qty = c ? Number(c.qty.toFixed(2)) : null;
      put(r, c0, qty); if (qty) addTot(c0, qty);
      if (d.packingVesselKg == null) {
        sheet.vessels.forEach((v, k) => { const n = c?.vessels?.[v] || null; put(r, c0 + 1 + k, n); if (n) addTot(c0 + 1 + k, n); });
      } else {
        const vc = c?.vesselCount || null; put(r, c0 + 1, vc); if (vc) addTot(c0 + 1, vc);
      }
    }
    r++;
  });

  // total row
  put(r, C_SNO, "", { bold: true, fill: TOTAL_FILL });
  put(r, C_ROUTE, "Total", { bold: true, fill: TOTAL_FILL });
  for (let c = C_INDENT0; c <= lastCol; c++) {
    const v = totals[c] != null ? Number(totals[c].toFixed(2)) : null;
    put(r, c, v, { bold: true, fill: TOTAL_FILL });
  }
  return r + 2; // next block start (blank gap)
}

export async function buildWorkbook(date: Date): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Delivery Sheet", { views: [{ showGridLines: false }] });
  const dateStr = date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const logoBuf = loadLogo();
  const logoId = logoBuf ? wb.addImage({ buffer: logoBuf as any, extension: "jpeg" }) : null;

  // column widths
  ws.getColumn(1).width = 5;
  ws.getColumn(2).width = 12;
  for (let c = 3; c <= 40; c++) ws.getColumn(c).width = 7;

  let r = 1;
  for (const [session, title] of [
    ["BREAKFAST", "Brandix Morning Delivery Sheet"],
    ["DINNER", "Brandix Evening Delivery Sheet"],
  ] as [Session, string][]) {
    const sheet = await computeSession(date, session);
    if (!sheet || sheet.rows.length === 0) {
      ws.getCell(r, 3).value = `${title} — no orders`;
      r += 2;
      continue;
    }
    // Say so on the sheet itself when a route has not booked: whoever cooks
    // from a printout should not have to remember which day it was short.
    const cov = await coverage(date, session);
    const heading = cov.ready
      ? title
      : `${title}  —  PARTIAL: ${cov.booked} of ${cov.total} routes booked`;
    r = renderBlock(wb, ws, r, heading, dateStr, sheet, logoId);
  }
  return wb;
}
