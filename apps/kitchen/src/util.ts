export function today(): Date {
  return new Date();
}
export function tomorrow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}
export function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
