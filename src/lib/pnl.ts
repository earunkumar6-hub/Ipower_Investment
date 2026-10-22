import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sum, ZERO } from "@/lib/money";

// Profit and Loss is a read model: it owns no tables. Income = E-Sevai service charges + other income entered
// in the Day Book; expenses count on the date they were spent, whoever paid. Commission is still recorded on
// receipts but is not shown or counted (owner's decision, 19 Oct 2026). Premiums and bills collected on behalf
// of others, wallet recharges and transfers between own accounts are not income or expense.

export type MonthRange = { from: Date; to: Date; label: string; key: string };

/** "2026-10" → [1 Oct, 1 Nov) */
export function monthRange(key: string): MonthRange {
  const [y, m] = key.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  return { from, to, key, label: from.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }) };
}

export const monthKey = (d: Date) => d.toISOString().slice(0, 7);
export const previousMonthKey = (key: string) => monthKey(new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 2, 1)));

type Line = { label: string; amount: Prisma.Decimal };

export async function profitAndLoss(tenantId: string, range: MonthRange) {
  const inMonth = { gte: range.from, lt: range.to };
  const [services, otherEntries, expenses] = await Promise.all([
    db.serviceTransaction.findMany({ where: { tenantId, status: "Saved", txnDate: inMonth }, include: { serviceType: true } }),
    // Other income and its reversals (a reversal is the same entry type, money out).
    db.dayBookEntry.findMany({ where: { tenantId, entryType: "OtherIncome", entryDate: inMonth }, select: { direction: true, amount: true } }),
    // Saved (within limit) and Approved expenses; Waiting, Rejected and Cancelled are not spent.
    db.expense.findMany({ where: { tenantId, status: { in: ["Saved", "Approved"] }, expenseDate: inMonth } }),
  ]);

  const group = <T,>(xs: T[], key: (x: T) => string, value: (x: T) => Prisma.Decimal): Line[] => {
    const m = new Map<string, Prisma.Decimal>();
    for (const x of xs) m.set(key(x), (m.get(key(x)) ?? ZERO).plus(value(x)));
    return [...m.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount.comparedTo(a.amount));
  };

  const serviceLines = group(services, (t) => t.serviceType.name, (t) => t.profit);
  const expenseLines = group(expenses, (e) => e.category, (e) => e.amount);
  const total = (ls: Line[]) => (ls.length ? sum(ls.map((l) => l.amount)) : ZERO);

  const serviceCharges = total(serviceLines);
  const otherIncome = otherEntries.reduce((t, e) => (e.direction === "In" ? t.plus(e.amount) : t.minus(e.amount)), ZERO);
  const income = serviceCharges.plus(otherIncome);
  const expenseTotal = total(expenseLines);
  return {
    range,
    serviceLines,
    serviceCharges,
    otherIncome,
    income,
    expenseLines,
    expenseTotal,
    profit: income.minus(expenseTotal),
  };
}

export type ProfitAndLoss = Awaited<ReturnType<typeof profitAndLoss>>;

/**
 * Owner statement (#19, #20): money the owner took out or put in this month. Never part of income, expenses or profit.
 * Rejected entries are listed but left out of the totals (their Day Book lines are reversed).
 */
export async function ownerStatement(tenantId: string, range: MonthRange) {
  const entries = await db.ownerEntry.findMany({
    where: { tenantId, entryDate: { gte: range.from, lt: range.to } },
    include: { account: { select: { type: true, name: true, bankName: true, last4: true } } },
    orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
  });
  const counted = entries.filter((e) => e.status !== "Rejected");
  const total = (kind: "Withdrawal" | "Contribution") => sum([ZERO, ...counted.filter((e) => e.kind === kind).map((e) => e.amount)]);
  const withdrawn = total("Withdrawal"), contributed = total("Contribution");
  return { entries, withdrawn, contributed, net: contributed.minus(withdrawn), pending: entries.filter((e) => e.status === "Pending").length };
}
