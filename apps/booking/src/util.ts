const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function dayEnum(d: Date): string {
  return DAYS[d.getDay()];
}

export function tomorrow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}

export function today(): Date {
  return new Date();
}

// YYYY-MM-DD in local time
export function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function prettyDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}
