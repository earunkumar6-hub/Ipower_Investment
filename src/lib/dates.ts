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

/** "12/10/2026" (dd/mm/yyyy everywhere) for business dates (already IST). */
export const fmtDate = (date: Date) => isoToDmy(isoDate(date));

/** "12/03/1985" (dd/mm/yyyy) for a DATE value, e.g. date of birth. */
export const fmtDmy = (date: Date) => isoToDmy(date.toISOString().slice(0, 10));

/** "1985-03-12" → "12/03/1985"; "" when it isn't yyyy-mm-dd. */
export const isoToDmy = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

/** "12/03/1985" → "1985-03-12"; "" unless it is a real calendar date. */
export function dmyToIso(dmy: string) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy);
  if (!m) return "";
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : "";
}

/** "3:42 pm" for timestamps, shown in IST. */
export const fmtTime = (date: Date) =>
  date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST });

/** Current IST wall-clock time as "14:05" (for <input type="time">). */
export const istNowHHMM = (d: Date = new Date()) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: IST }).format(d);

/** "14:05" → "2:05 pm". */
export function fmtHHMM(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** "12/10/2026, 3:42 pm" in IST. */
export const fmtDateTime = (date: Date) => `${fmtDate(istDate(date))}, ${fmtTime(date)}`;

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
