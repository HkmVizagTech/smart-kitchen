// Order-window rules.
//   Tiffin (breakfast) + Dinner -> ordered TODAY for TOMORROW.
//   Lunch -> ordered SAME DAY, before 11:00 AM.
//   Emergency -> anytime (count only, needs super-admin approval).
//
// TIMEZONE: these rules are about the user's day in India, but the API runs on
// Railway where the container clock is UTC. Using the raw Date getters meant
// the 11:00 AM lunch cutoff actually fired at 16:30 IST, and between midnight
// and 05:30 IST the server still thought it was the previous day — so a real
// "today for tomorrow" booking made late at night was rejected. Everything
// below is therefore evaluated in APP_TZ, not in the container's zone.

export type Session = "BREAKFAST" | "LUNCH" | "DINNER";

export interface WindowCheck {
  allowed: boolean;
  reason: string;
}

export const APP_TZ =
  (typeof process !== "undefined" && process.env?.APP_TIMEZONE) || "Asia/Kolkata";

const LUNCH_DEADLINE_HOUR = 11; // 11:00 AM, India time

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

/** Calendar date in APP_TZ as "YYYY-MM-DD". */
function tzYmd(d: Date): string {
  return dayFmt.format(d);
}

/** Wall-clock hour in APP_TZ. */
function tzHour(d: Date): number {
  return Number(hourFmt.format(d).slice(0, 2));
}

/**
 * The calendar date an order is FOR.
 *
 * `forDate` is built from a plain "YYYY-MM-DD" string, which JavaScript parses
 * as UTC midnight — so its UTC date parts are the intended day. Reading it in
 * a local zone would shift it.
 */
function targetYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00.000Z`);
  const b = Date.parse(`${toYmd}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

// `now` is a real instant; `forDate` is the day the food is FOR.
export function canPlaceOrder(
  session: Session,
  now: Date,
  forDate: Date,
  isEmergency = false
): WindowCheck {
  if (isEmergency) return { allowed: true, reason: "Emergency order (needs approval)." };

  const dayDiff = daysBetween(tzYmd(now), targetYmd(forDate));

  if (session === "BREAKFAST" || session === "DINNER") {
    return dayDiff === 1
      ? { allowed: true, reason: "Today for tomorrow." }
      : { allowed: false, reason: "Tiffin & dinner can only be ordered today, for tomorrow." };
  }

  // LUNCH — same day, before 11:00 AM India time
  if (dayDiff !== 0) return { allowed: false, reason: "Lunch is ordered on the same day only." };
  if (tzHour(now) >= LUNCH_DEADLINE_HOUR)
    return { allowed: false, reason: "Lunch cutoff (11:00 AM) has passed." };
  return { allowed: true, reason: "Same-day lunch before 11:00 AM." };
}
