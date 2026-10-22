import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sum, ZERO } from "@/lib/money";

// Commission received (change set #18) – Super Admin only. An owner-only ledger: never in the Day Book, so bank
// balances and tallies that Admins see leave it out. Counted in P&L for the month it is *for* (`forMonth`).

export const COMMISSION_SOURCES = ["LIC", "Post Office", "SBI Life", "Star Health", "Care Health", "SBI General", "Mutual funds (AMC)"];

/** "2026-09" → "2026-27" (April–March). */
export function fyOfMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** The months of a financial year, April first: "2026-27" → ["2026-04", …, "2027-03"]. */
export function fyMonths(fy: string) {
  const start = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1;
    return `${m >= 4 ? start : start + 1}-${String(m).padStart(2, "0")}`;
  });
}

export const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

const total = (xs: { amount: Prisma.Decimal }[]) => (xs.length ? sum(xs.map((x) => x.amount)) : ZERO);

/** Saved commission for one month (P&L line "Commission earned (consolidated)"). */
export async function commissionForMonth(tenantId: string, month: string) {
  const rows = await db.commissionReceipt.findMany({ where: { tenantId, forMonth: month, status: "Saved" }, select: { amount: true } });
  return total(rows);
}

/** Cards, month-by-month for `fy`, every FY, and the entries of `fy` (cancelled ones listed, not counted). */
export async function commissionSummary(tenantId: string, currentMonth: string, fy: string) {
  const [all, entries] = await Promise.all([
    db.commissionReceipt.findMany({ where: { tenantId, status: "Saved" }, select: { forMonth: true, amount: true } }),
    db.commissionReceipt.findMany({
      where: { tenantId, forMonth: { in: fyMonths(fy) } },
      include: { account: { select: { type: true, name: true, bankName: true, last4: true } } },
      orderBy: [{ forMonth: "desc" }, { receivedOn: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const thisMonth = all.filter((r) => r.forMonth === currentMonth);
  const fys = [...new Set(all.map((r) => fyOfMonth(r.forMonth)))].sort().reverse();
  return {
    cards: {
      thisMonth: total(thisMonth),
      thisFy: total(all.filter((r) => fyOfMonth(r.forMonth) === fyOfMonth(currentMonth))),
      entriesThisMonth: thisMonth.length,
    },
    byMonth: fyMonths(fy).map((m) => {
      const rows = all.filter((r) => r.forMonth === m);
      return { month: m, entries: rows.length, amount: total(rows) };
    }),
    byFy: fys.map((y) => {
      const rows = all.filter((r) => fyOfMonth(r.forMonth) === y);
      return { fy: y, entries: rows.length, amount: total(rows) };
    }),
    entries,
  };
}

/** Sources to offer: the usual ones plus any typed before. */
export async function commissionSources(tenantId: string) {
  const used = await db.commissionReceipt.findMany({ where: { tenantId }, distinct: ["source"], select: { source: true } });
  return [...new Set([...COMMISSION_SOURCES, ...used.map((u) => u.source)])];
}
