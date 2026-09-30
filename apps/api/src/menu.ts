// What is cooked on a given day.
//
// The kitchen keeps a repeating plan — tiffin on a one-week cycle, lunch on a
// fortnight — and changes a single day now and then. Resolving a date means:
// look for rows pinned to that exact date first, and fall back to the
// repeating plan for that weekday and week-of-cycle.
//
// This is what lets a booker enter three numbers instead of picking from
// sixteen dishes: the menu already knows that Tuesday's Item 2 is Biryani, and
// that Kurma comes with it.

import { prisma } from "@sk/db";
import { dayRange } from "./time.js";

const WEEKDAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

/** An order's date is stored as UTC midnight, so read the weekday in UTC —
 *  a local read flips the day for anyone west of Greenwich. */
export function weekdayOf(date: Date): string {
  return WEEKDAY[date.getUTCDay()];
}

/** ISO-8601 week number. Used to place a date within a multi-week cycle. */
function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Thursday decides the year an ISO week belongs to.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - (firstThursday.getUTCDay() || 7));
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

/** How many weeks this session's plan runs for before repeating. */
async function cycleLength(session: string): Promise<number> {
  const longest = await prisma.menuSlot.aggregate({
    where: { session: session as any, date: null },
    _max: { week: true },
  });
  return Math.max(1, longest._max.week ?? 1);
}

export type ResolvedSlot = Awaited<ReturnType<typeof menuFor>>[number];

/** The menu lines for one date and meal, in booking order. */
export async function menuFor(date: Date, session: string) {
  const include = {
    dish: true,
    accompaniments: { include: { dish: true } },
  } as const;
  const orderBy = { sortOrder: "asc" } as const;

  // A one-off change for this exact day wins over the repeating plan.
  const pinned = await prisma.menuSlot.findMany({
    where: { session: session as any, date: dayRange(date) },
    include,
    orderBy,
  });
  if (pinned.length > 0) return pinned;

  const week = ((isoWeek(date) - 1) % (await cycleLength(session))) + 1;
  return prisma.menuSlot.findMany({
    where: { session: session as any, day: weekdayOf(date) as any, week, date: null },
    include,
    orderBy,
  });
}

/**
 * Turn the booker's three plate counts into order lines.
 *
 * Each menu line contributes its main dish AND the accompaniments that hang
 * off it, both at that line's plate count. A dish appearing on more than one
 * line accumulates — which is exactly how the real packing sheet gets its
 * Sambar total: it sits on both Item 1 and Item 3, so its quantity is
 * (idly plates + wada plates), not one or the other.
 */
export async function expandSlots(
  date: Date,
  session: string,
  slots: Partial<Record<"ITEM1" | "ITEM2" | "ITEM3", number>>
): Promise<{ items: { dishId: number; plates: number }[]; totalPlates: number; missing: boolean }> {
  const menu = await menuFor(date, session);
  const bookable = menu.filter((s) => s.group);
  if (bookable.length === 0) return { items: [], totalPlates: 0, missing: true };

  const plates = new Map<number, number>();
  const add = (dishId: number, n: number) => plates.set(dishId, (plates.get(dishId) ?? 0) + n);

  let total = 0;
  for (const slot of bookable) {
    const n = Number(slots[slot.group as "ITEM1"] ?? 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    total += n;
    add(slot.dishId, n);
    for (const a of slot.accompaniments) add(a.dishId, n);
  }

  return {
    items: [...plates].map(([dishId, p]) => ({ dishId, plates: p })),
    // The booker's own number, which is what the packing sheet's "Total"
    // column shows — accompaniments are not double-counted into it.
    totalPlates: total,
    missing: false,
  };
}
