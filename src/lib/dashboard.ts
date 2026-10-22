import type { DayBookEntry, LeadSource, Prisma } from "@prisma/client";
import { accountDay, earliestOpenDayBefore } from "@/lib/daybook";
import { daysPastGrace } from "@/lib/daybook-grace";
import { addDays, fmtDate, isoDate, istToday } from "@/lib/dates";
import { db, type Tx } from "@/lib/db";
import { canApprove } from "@/lib/expenses";
import { LEAD_SOURCE_LABEL } from "@/lib/lead-labels";
import { callInclude, callParty } from "@/lib/leads";
import { fmtINR, sum, ZERO } from "@/lib/money";
import { monthKey, monthRange, profitAndLoss } from "@/lib/pnl";
import { refreshOverdue } from "@/lib/renewals";
import type { SessionUser } from "@/lib/session";

// Dashboard numbers per role (fl_crm_demo.json → modules D02). Refreshed on page load.

const IST_OFFSET = 5.5 * 3_600_000;
/** Start of the IST calendar day as an instant (for timestamp columns like createdAt). */
const dayStart = (d: Date) => new Date(d.getTime() - IST_OFFSET);
const signed = (e: Pick<DayBookEntry, "direction" | "amount">) => (e.direction === "In" ? e.amount : e.amount.negated());
const net = (xs: Pick<DayBookEntry, "direction" | "amount">[]) => (xs.length ? sum(xs.map(signed)) : ZERO);

async function renewalsDueThisWeek(tenantId: string, today: Date, ownerId?: string) {
  return db.renewalItem.findMany({
    where: { tenantId, status: "Due", dueDate: { gte: today, lt: addDays(today, 7) }, ...(ownerId && { policy: { ownerId } }) },
    include: { policy: { include: { customer: { select: { id: true, name: true } } } } },
    orderBy: { dueDate: "asc" },
  });
}

export async function userDashboard(user: SessionUser) {
  const today = istToday();
  const now = new Date();
  await refreshOverdue(user.tenantId, today);
  const [leads, newToday, calls, renewals, receipts] = await Promise.all([
    db.lead.count({ where: { tenantId: user.tenantId, ownerId: user.id, status: { not: "NotInterested" }, stage: { not: "Customer" } } }),
    db.lead.count({ where: { tenantId: user.tenantId, ownerId: user.id, createdAt: { gte: dayStart(today) } } }),
    db.call.findMany({
      where: { tenantId: user.tenantId, ownerId: user.id, outcome: null, dueAt: { lt: dayStart(addDays(today, 1)) } },
      include: callInclude,
      orderBy: { dueAt: "asc" },
    }).then((cs) => cs.map((c) => ({ ...c, party: callParty(c) }))),
    renewalsDueThisWeek(user.tenantId, today, user.id),
    db.receipt.findMany({ where: { tenantId: user.tenantId, createdById: user.id, receiptDate: today, status: "Saved" } }),
  ]);
  const cash = receipts.filter((r) => r.mode === "Cash");
  return {
    leads, newToday,
    callsToday: calls.filter((c) => c.dueAt >= dayStart(today)).length,
    callsOverdue: calls.filter((c) => c.dueAt <= now).length,
    calls,
    renewals,
    renewalsPremium: renewals.length ? sum(renewals.map((r) => r.premiumAmount)) : ZERO,
    collections: receipts.length ? sum(receipts.map((r) => r.amount)) : ZERO,
    collectionsCash: cash.length ? sum(cash.map((r) => r.amount)) : ZERO,
    collectionsOther: receipts.length ? sum(receipts.filter((r) => r.mode !== "Cash").map((r) => r.amount)) : ZERO,
  };
}

export async function adminDashboard(user: SessionUser) {
  const tenantId = user.tenantId;
  const today = istToday();
  await refreshOverdue(tenantId, today);
  const [newLeads, renewals, overdue, entries, accounts, cashClose, waiting, openCalls, slips, collectedRd, approvedUnpaid] = await Promise.all([
    db.lead.findMany({ where: { tenantId, createdAt: { gte: dayStart(today) } }, select: { source: true } }),
    renewalsDueThisWeek(tenantId, today),
    db.renewalItem.findMany({ where: { tenantId, status: "Overdue" }, select: { dueDate: true }, orderBy: { dueDate: "asc" } }),
    db.dayBookEntry.findMany({ where: { tenantId, entryDate: today, entryType: "Collection" }, include: { account: { select: { type: true } } } }),
    db.account.findMany({ where: { tenantId } }),
    db.dayClose.findFirst({ where: { tenantId, date: today, account: { type: "Cash" } } }),
    db.expense.findMany({ where: { tenantId, status: "Waiting" } }),
    db.call.findMany({ where: { tenantId, outcome: null }, select: { dueAt: true, ownerId: true } }),
    db.ownerPaidSlip.findMany({ where: { tenantId, status: { in: ["CustomerOwes", "CollectedReturnToOwner"] } } }),
    db.receipt.findMany({ where: { tenantId, status: "Saved", rdStatus: "Collected", ownerPaid: false }, select: { receiptDate: true, amount: true } }),
    db.expense.findMany({ where: { tenantId, status: "Approved", paidBy: "Company" }, select: { id: true } }),
  ]);
  const days = await accountDay(db as unknown as Tx, tenantId, today);
  const day = (type: string) => days.filter((d) => d.type === type);
  const cashDay = day("Cash")[0];
  const bankDay = day("Bank")[0];
  const wallets = day("Wallet").map((w) => {
    const low = accounts.find((a) => a.id === w.accountId)?.lowBalanceThreshold;
    return { name: w.name, closing: w.closing, low: !!low && w.closing.lt(low) };
  });
  const bySource = Object.entries(
    newLeads.reduce<Record<string, number>>((m, l) => ({ ...m, [LEAD_SOURCE_LABEL[l.source as LeadSource]]: (m[LEAD_SOURCE_LABEL[l.source as LeadSource]] ?? 0) + 1 }), {}),
  );
  const paidIds = new Set(
    (await db.dayBookEntry.findMany({
      where: { sourceType: "Expense", sourceId: { in: approvedUnpaid.map((e) => e.id) }, reversalOfId: null, reversedBy: { is: null } },
      select: { sourceId: true },
    })).map((e) => e.sourceId),
  );
  const earlierOpen = await earliestOpenDayBefore(db as unknown as Tx, tenantId, today);
  const [{ dayCloseGraceDays }, ownerPending] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { dayCloseGraceDays: true } }),
    db.ownerEntry.findMany({ where: { tenantId, status: "Pending" }, select: { amount: true } }),
  ]);
  const pastGrace = await daysPastGrace(db as unknown as Tx, tenantId, today, dayCloseGraceDays);
  const counted = cashClose?.physical ?? null;
  const oldestRd = collectedRd.reduce<Date | null>((m, r) => (!m || r.receiptDate < m ? r.receiptDate : m), null);
  const sumAmt = <T extends { amount: Prisma.Decimal }>(xs: T[]) => (xs.length ? sum(xs.map((x) => x.amount)) : ZERO);
  const owes = slips.filter((s) => s.status === "CustomerOwes");
  const toReturn = slips.filter((s) => s.status === "CollectedReturnToOwner");

  return {
    newLeads: newLeads.length,
    newLeadsBySource: bySource.map(([k, n]) => `${n} ${k.toLowerCase()}`).join(" · ") || "none yet",
    renewals,
    renewalsPremium: renewals.length ? sum(renewals.map((r) => r.premiumAmount)) : ZERO,
    overdueCount: overdue.length,
    oldestOverdueDays: overdue[0] ? Math.round((today.getTime() - overdue[0].dueDate.getTime()) / 86_400_000) : 0,
    collections: net(entries),
    collectionsCash: net(entries.filter((e) => e.account.type === "Cash")),
    collectionsUpi: net(entries.filter((e) => e.account.type !== "Cash")),
    cashInHand: counted ?? cashDay.closing,
    cashStatus: counted === null ? "NOT COUNTED" : counted.equals(cashDay.closing) ? "TALLIED" : "NOT TALLIED",
    bank: { name: bankDay.name, closing: bankDay.closing },
    wallets,
    walletTotal: wallets.length ? sum(wallets.map((w) => w.closing)) : ZERO,
    waitingCount: waiting.length,
    waitingAdmin: sumAmt(waiting.filter((e) => e.approvalLevel === "Admin")),
    waitingSuperAdmin: sumAmt(waiting.filter((e) => e.approvalLevel === "SuperAdmin")),
    actions: {
      openCalls: openCalls.length,
      overdueCalls: openCalls.filter((c) => c.dueAt <= new Date()).length,
      ownerOwes: { count: owes.length, amount: sumAmt(owes) },
      toReturn: { count: toReturn.length, amount: sumAmt(toReturn) },
      toApprove: waiting.filter((e) => canApprove(user, e)),
      toPay: approvedUnpaid.filter((e) => !paidIds.has(e.id)).length,
      earlierOpen,
      pastGrace, // alert: days past the grace period, not closed (Super Admin only can close them)
      graceDays: dayCloseGraceDays,
      ownerPending: { count: ownerPending.length, amount: sumAmt(ownerPending) },
      todayStatus: cashClose?.status === "Closed" ? "Closed" : counted === null ? "Open – not counted" : "Open – counted",
      rdNotDeposited: { count: collectedRd.length, amount: sumAmt(collectedRd), oldestDays: oldestRd ? Math.round((today.getTime() - oldestRd.getTime()) / 86_400_000) : 0 },
    },
  };
}

export type ActionItem = { item: string; detail: string; who: string; href: string };

/** The "Needs your action" list (Admin and Owner dashboards and their Excel export). */
export function actionItems(a: Awaited<ReturnType<typeof adminDashboard>>["actions"]): ActionItem[] {
  const actions: ActionItem[] = [];
  if (a.openCalls) actions.push({ item: "Calls open", detail: `${a.openCalls}${a.overdueCalls ? ` (${a.overdueCalls} overdue)` : ""}`, who: "Users", href: "/leads" });
  if (a.ownerOwes.count || a.toReturn.count) actions.push({ item: "Owner-paid RD", detail: `${a.ownerOwes.count} customers owe ${fmtINR(a.ownerOwes.amount)} · ${fmtINR(a.toReturn.amount)} to return to owner`, who: "Admin", href: "/receipts?tab=owner" });
  for (const e of a.toApprove) actions.push({ item: `Expense ${e.expenseNo}`, detail: `${e.description} ${fmtINR(e.amount)}`, who: e.approvalLevel === "SuperAdmin" ? "Super Admin" : "Admin", href: "/expenses?tab=approve" });
  if (a.toPay) actions.push({ item: "Expenses to pay", detail: `${a.toPay} approved, not yet paid`, who: "Admin", href: "/expenses" });
  if (a.pastGrace.length) {
    actions.push({
      item: "Day Book past grace period", detail: `${a.pastGrace.length} day(s) not closed within ${a.graceDays} days (oldest ${fmtDate(a.pastGrace[0])}) – only the Super Admin can close them`,
      who: "Super Admin", href: `/daybook?date=${isoDate(a.pastGrace[0])}`,
    });
  }
  if (a.ownerPending.count) actions.push({ item: "Owner entries to confirm", detail: `${a.ownerPending.count} · ${fmtINR(a.ownerPending.amount)}`, who: "Super Admin", href: "/daybook" });
  if (a.earlierOpen) actions.push({ item: "Previous Day Book open", detail: `${fmtDate(a.earlierOpen)} is not closed`, who: "Admin", href: `/daybook?date=${isoDate(a.earlierOpen)}` });
  actions.push({ item: "Day Book today", detail: a.todayStatus, who: "Admin", href: "/daybook" });
  if (a.rdNotDeposited.count) actions.push({ item: "RD collected, not deposited", detail: `${a.rdNotDeposited.count} receipts · ${fmtINR(a.rdNotDeposited.amount)} · oldest ${a.rdNotDeposited.oldestDays ? `${a.rdNotDeposited.oldestDays} d` : "today"}`, who: "Users", href: "/daybook" });
  return actions;
}

export async function ownerExtras(user: SessionUser) {
  const tenantId = user.tenantId;
  const today = istToday();
  const pnl = await profitAndLoss(tenantId, monthRange(monthKey(today)));
  const slips = await db.ownerPaidSlip.findMany({ where: { tenantId, status: { in: ["CustomerOwes", "CollectedReturnToOwner"] } } });
  const owes = slips.filter((s) => s.status === "CustomerOwes");
  const toReturn = slips.filter((s) => s.status === "CollectedReturnToOwner");
  // Collections for the last 7 days, cash vs UPI/bank (Day Book collection entries, net of reversals).
  const from = addDays(today, -6);
  const entries = await db.dayBookEntry.findMany({
    where: { tenantId, entryType: "Collection", entryDate: { gte: from, lte: today } },
    include: { account: { select: { type: true } } },
  });
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(from, i);
    const of = entries.filter((e) => e.entryDate.getTime() === d.getTime());
    return {
      day: d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", timeZone: "UTC" }),
      cash: Number(net(of.filter((e) => e.account.type === "Cash")).toFixed(2)),
      upi: Number(net(of.filter((e) => e.account.type !== "Cash")).toFixed(2)),
    };
  });
  return {
    profit: pnl.profit,
    income: pnl.income,
    expenses: pnl.expenseTotal,
    ownerOwed: (owes.length ? sum(owes.map((s) => s.amount)) : ZERO).plus(toReturn.length ? sum(toReturn.map((s) => s.amount)) : ZERO),
    customerOwes: owes.length ? sum(owes.map((s) => s.amount)) : ZERO,
    toReturn: toReturn.length ? sum(toReturn.map((s) => s.amount)) : ZERO,
    week,
  };
}

export type Slice = { label: string; value: number };

/** Keep the largest five slices and fold the rest into "Other" (a pie stays readable at ≤ 6). */
function topSlices(xs: Slice[]): Slice[] {
  const sorted = xs.filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= 6) return sorted;
  const rest = sorted.slice(5).reduce((t, x) => t + x.value, 0);
  return [...sorted.slice(0, 5), { label: "Other", value: rest }];
}

/** Owner only: this month's expenses by category (same numbers as P&L). Commission is shown only on P&L. */
export async function ownerPies(user: SessionUser) {
  const range = monthRange(monthKey(istToday()));
  const pnl = await profitAndLoss(user.tenantId, range);
  return {
    month: range.label,
    expenses: topSlices(pnl.expenseLines.map((l) => ({ label: l.label, value: Number(l.amount) }))),
  };
}

/** Admin and Owner: money collected this month (receipts + E-Sevai), split by who recorded it. */
export async function collectionsByStaff(user: SessionUser) {
  const tenantId = user.tenantId;
  const range = monthRange(monthKey(istToday()));
  const [receipts, services, users] = await Promise.all([
    db.receipt.groupBy({ by: ["createdById"], where: { tenantId, status: "Saved", receiptDate: { gte: range.from, lt: range.to } }, _sum: { amount: true } }),
    db.serviceTransaction.groupBy({ by: ["createdById"], where: { tenantId, status: "Saved", txnDate: { gte: range.from, lt: range.to } }, _sum: { customerAmount: true } }),
    db.user.findMany({ where: { tenantId }, select: { id: true, name: true } }),
  ]);
  return {
    month: range.label,
    slices: topSlices(users.map((u) => ({
      label: u.name,
      value: Number(receipts.find((r) => r.createdById === u.id)?._sum.amount ?? 0) + Number(services.find((s) => s.createdById === u.id)?._sum.customerAmount ?? 0),
    }))),
  };
}
