// Time helpers.
//
// Two clocks were being confused before this file existed:
//
//   * "What day is it for the user?"  -> India (Asia/Kolkata). Railway
//     containers run UTC, so `new Date().getHours()` was giving UTC hours and
//     the 11:00 AM lunch cutoff was really firing at 16:30 IST. Between
//     midnight and 05:30 IST the server also still thought it was yesterday.
//
//   * "What day is this order stored under?" -> UTC midnight. Orders are
//     created from a plain "YYYY-MM-DD" string, which `new Date()` parses as
//     UTC midnight, so every date range query must be built in UTC too.
//
// Keep those two apart and the date bugs go away.

export const APP_TZ = process.env.APP_TIMEZONE ?? "Asia/Kolkata";

const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hourFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Calendar date in the app's timezone, as "YYYY-MM-DD". */
export function localYmd(now: Date = new Date()): string {
  return dayFmt.format(now);
}

/** Wall-clock time in the app's timezone, as { hour, minute }. */
export function localTime(now: Date = new Date()): { hour: number; minute: number } {
  const [h, m] = hourFmt.format(now).split(":");
  return { hour: Number(h), minute: Number(m) };
}

/** The UTC calendar date of a stored Date, as "YYYY-MM-DD". */
export function storedYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Shift a "YYYY-MM-DD" string by a number of days. */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return storedYmd(d);
}

/** Whole days from `fromYmd` to `toYmd` (both "YYYY-MM-DD"). */
export function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00.000Z`);
  const b = Date.parse(`${toYmd}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Half-open UTC range covering one stored day: { gte: start, lt: end }.
 * Accepts either a "YYYY-MM-DD" string or a Date built from one.
 */
export function dayRange(day: string | Date): { gte: Date; lt: Date } {
  const ymd = typeof day === "string" ? day.slice(0, 10) : storedYmd(day);
  const gte = new Date(`${ymd}T00:00:00.000Z`);
  const lt = new Date(gte);
  lt.setUTCDate(lt.getUTCDate() + 1);
  return { gte, lt };
}
