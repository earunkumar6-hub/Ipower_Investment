import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sum, ZERO } from "@/lib/money";

// Profit and Loss is a read model: it owns no tables. Income = service charges + insurer/mutual fund
// commission (gross); expenses count on the date they were spent, whoever paid. Post office commission is
// still recorded on RD receipts but is not business income (owner's choice, Oct 2026). Premiums and bills
// collected on behalf of others, wallet recharges and transfers between own accounts are not income or expense.

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
  const [services, commissions, expenses] = await Promise.all([
    db.serviceTransaction.findMany({ where: { tenantId, status: "Saved", txnDate: inMonth }, include: { serviceType: true } }),
    db.commission.findMany({ where: { tenantId, sourceType: "Partner", status: { not: "Cancelled" }, earnedOn: inMonth } }),
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
  const gross = (cs: typeof commissions) => (cs.length ? sum(cs.map((c) => c.gross)) : ZERO);

  const serviceCharges = total(serviceLines);
  const commissionPartner = gross(commissions);
  const income = serviceCharges.plus(commissionPartner);
  const expenseTotal = total(expenseLines);
  return {
    range,
    serviceLines,
    serviceCharges,
    commissionPartner,
    income,
    expenseLines,
    expenseTotal,
    profit: income.minus(expenseTotal),
    tdsCredit: commissions.length ? sum(commissions.map((c) => c.tds)) : ZERO,
    commissionReceived: gross(commissions.filter((c) => c.status === "Received")),
    commissionExpected: gross(commissions.filter((c) => c.status === "Expected")),
  };
}

export type ProfitAndLoss = Awaited<ReturnType<typeof profitAndLoss>>;
