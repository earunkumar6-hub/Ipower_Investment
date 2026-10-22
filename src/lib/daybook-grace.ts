import { addDays } from "@/lib/dates";
import type { Tx } from "@/lib/db";
import { daysBetween } from "@/lib/overdue";

// Day Book grace period (change set #10): a day can be closed up to `graceDays` days later (Settings → Day Book,
// default 3). After that it is locked for Admins – only the Super Admin can close it – and Admins are alerted
// (dashboard action + Day Book banner). Posting to the day is not affected (owner, 22 Oct 2026).

export type GraceState =
  | { state: "today" }
  | { state: "grace"; day: number; of: number }
  | { state: "locked"; daysLate: number; of: number };

export function graceState(date: Date, today: Date, graceDays: number): GraceState {
  const late = daysBetween(date, today);
  if (late <= 0) return { state: "today" };
  return late <= graceDays ? { state: "grace", day: late, of: graceDays } : { state: "locked", daysLate: late, of: graceDays };
}

/** Header badge text for an open day: "OPEN", "OPEN · grace day 2 of 3", "LOCKED · Super Admin to close". */
export function graceBadge(g: GraceState) {
  return g.state === "today" ? "OPEN" : g.state === "grace" ? `OPEN · grace day ${g.day} of ${g.of}` : "LOCKED · Super Admin to close";
}

/** Days with Day Book entries, past the grace period and still not closed (oldest first). */
export async function daysPastGrace(tx: Pick<Tx, "dayBookEntry" | "dayClose">, tenantId: string, today: Date, graceDays: number) {
  const cutoff = addDays(today, -graceDays); // a day before this is past its grace
  const [withEntries, closed] = await Promise.all([
    tx.dayBookEntry.groupBy({ by: ["entryDate"], where: { tenantId, entryDate: { lt: cutoff } }, orderBy: { entryDate: "asc" } }),
    tx.dayClose.findMany({ where: { tenantId, status: "Closed", date: { lt: cutoff } }, select: { date: true }, distinct: ["date"] }),
  ]);
  const closedDays = new Set(closed.map((c) => c.date.getTime()));
  return withEntries.map((e) => e.entryDate).filter((d) => !closedDays.has(d.getTime()));
}
