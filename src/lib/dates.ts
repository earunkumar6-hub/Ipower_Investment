const IST = "Asia/Kolkata";
const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: IST });

/** IST calendar date of `d` as a UTC-midnight Date (matches Postgres DATE columns). */
export function istDate(d: Date = new Date()): Date {
  return new Date(`${ymd.format(d)}T00:00:00Z`);
}

export const istToday = () => istDate();

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** "2026-10-12" */
export const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** Indian financial year (April–March), e.g. "2026-27". */
export function financialYear(date: Date): string {
  const y = date.getUTCFullYear();
  const start = date.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** "12 Oct 2026" for business dates (already IST). */
export const fmtDate = (date: Date) =>
  date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "3:42 pm" for timestamps, shown in IST. */
export const fmtTime = (date: Date) =>
  date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST });

/** "12 Oct, 3:42 pm" in IST. */
export const fmtDateTime = (date: Date) =>
  date.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST });

/** Parse a <input type="datetime-local"> value as IST wall-clock time. */
export function parseIstDateTime(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Inverse of parseIstDateTime, for default input values. */
export const toIstInput = (date: Date) =>
  new Date(date.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 16);

/** Same day-of-month `n` months later, clamped to month end (31 Jan + 1 → 28/29 Feb). */
export function addMonths(date: Date, n: number): Date {
  const y = date.getUTCFullYear(), m = date.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), last)));
}
