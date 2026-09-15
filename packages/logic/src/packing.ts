// Packing engine — verified against the 28 Apr 2026 delivery sheet.
// Counted dishes (idly, wada): greedy largest vessel, then round remainder UP
// to the smallest vessel that covers it. Weight dishes: qty_kg / vessel_kg.

export type VesselFill = Record<number, number>; // size -> count

export function fillVessels(qty: number, vessels: number[]): VesselFill {
  const sizes = [...vessels].sort((a, b) => b - a);
  const out: VesselFill = {};
  for (const v of sizes) out[v] = 0;
  if (qty <= 0) return out;

  const largest = sizes[0];
  const n = Math.floor(qty / largest);
  out[largest] += n;
  const rem = qty - n * largest;
  if (rem > 0) {
    const covering = sizes.filter((v) => v >= rem);
    const chosen = covering.length ? Math.min(...covering) : largest;
    out[chosen] += 1;
  }
  return out;
}

export interface DishCalcInput {
  name: string;
  kind: "count" | "weight";
  packingFactor: number; // per-plate grams (weight) or pieces (count)
  vesselKg?: number; // weight dishes only
  plates: number; // plate count this dish applies to
  vessels?: number[]; // counted dishes only
}

export interface DishCalcResult {
  name: string;
  qty: number; // pieces (count) or kg (weight)
  vessels?: VesselFill; // counted dishes
  vesselCount?: number; // weight dishes (qty_kg / vessel_kg)
}

export function calcDish(d: DishCalcInput): DishCalcResult {
  if (d.kind === "count") {
    const qty = d.packingFactor * d.plates;
    return { name: d.name, qty, vessels: fillVessels(qty, d.vessels ?? []) };
  }
  const qtyKg = round1((d.packingFactor * d.plates) / 1000);
  const vesselCount = d.vesselKg ? round1(qtyKg / d.vesselKg) : 0;
  return { name: d.name, qty: qtyKg, vesselCount };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
