import { receiptRef } from "@/lib/payment-lines";
import type { Frequency, Policy, Prisma, RenewalStatus } from "@prisma/client";
import { overdueText } from "@/lib/overdue";
import type { Tone } from "@/components/status-badge";
import { addMonths } from "@/lib/dates";
import { db } from "@/lib/db";
import { companyStatus, depositStatusSelect, nameLookup, type CompanyStatus } from "@/lib/deposit-status";
import { ownerScope, userNames } from "@/lib/leads";
import { maturityShown, PO_SCHEMES, PRODUCT_SHORT, renewalFilter, type Params } from "@/lib/lists";
import { sum, ZERO } from "@/lib/money";
import type { SessionUser } from "@/lib/session";

const STEP_MONTHS: Record<Frequency, number | null> = { Monthly: 1, Quarterly: 3, HalfYearly: 6, Yearly: 12, OneTime: null };

/**
 * Due dates after the start (first premium is paid at issue), up to `horizonMonths`
 * ahead and within the term. Yearly → 1 date, Monthly → 12.
 */
export function renewalDueDates(start: Date, frequency: Frequency, termMonths?: number | null, horizonMonths = 12): Date[] {
  const step = STEP_MONTHS[frequency];
  if (!step) return [];
  const limit = Math.min(horizonMonths, termMonths ?? Infinity);
  const dates: Date[] = [];
  for (let m = step; m <= limit; m += step) dates.push(addMonths(start, m));
  return dates;
}

/**
 * Run before reading renewals: unpaid instalments past their due date become Overdue, and billed policies whose
 * maturity has passed with nothing left unpaid become Matured (bills and reminders stop). One-time post office
 * deposits are not touched here – they stay as a maturity reminder until someone marks them matured.
 */
export async function refreshOverdue(tenantId: string, today: Date) {
  await db.renewalItem.updateMany({ where: { tenantId, status: "Due", dueDate: { lt: today } }, data: { status: "Overdue" } });
  const due = await db.policy.findMany({
    where: {
      tenantId, status: "Active", frequency: { not: "OneTime" }, productType: { not: "MutualFund" }, termMonths: { not: null },
      NOT: { product: { invoiceRule: { in: ["UntilClosed", "None"] } } }, renewals: { none: { status: { in: ["Due", "Overdue"] } } },
    },
    select: { id: true, startDate: true, termMonths: true },
  });
  for (const p of due) {
    const matures = addMonths(p.startDate, p.termMonths!);
    if (matures <= today) await db.policy.updateMany({ where: { id: p.id, status: "Active" }, data: { status: "Matured", closedOn: matures } });
  }
}

export const maturityDate = (p: Pick<Policy, "startDate" | "termMonths">) => (p.termMonths ? addMonths(p.startDate, p.termMonths) : null);

type RowPolicy = Policy & { customer: { id: string; name: string; mobile: string | null } };

/** An instalment to collect, the maturity of a one-time post office deposit (a reminder only), or a policy not renewed. */
export type RenewalRow = {
  id: string;
  kind: "instalment" | "maturity";
  policy: RowPolicy;
  date: Date;
  amount: Prisma.Decimal; // instalment, or the deposited amount for a maturity
  status: RenewalStatus;
  paidOn: Date | null;
  paidReceiptId: string | null;
  paidReceiptNo: string | null; // the customer's receipt: the AA- receipt when paid with other dues
  paidReceiptHref: string | null;
  collectedBy: string | null; // user who entered the receipt (Paid tab)
  companyStatus: CompanyStatus | null; // Paid tab only
  lastReminderAt: Date | null;
  reminderCount: number;
  lastReminderChannel: string | null; // from Sent messages (#24)
};

/** By customer tab: everything one customer owes and has paid, across their policies. */
export type CustomerRenewalRow = {
  customer: { id: string; name: string }; policies: string[];
  dueThisMonth: Prisma.Decimal; paidThisYear: Prisma.Decimal; overdue: Prisma.Decimal; ownerPaidOwed: Prisma.Decimal;
};

const monthBounds = (today: Date) => ({ from: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)), to: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)) });
/** Financial year start (1 April). */
const fyStart = (today: Date) => new Date(Date.UTC(today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1, 3, 1));
const total = (xs: { premiumAmount: Prisma.Decimal }[]) => (xs.length ? sum(xs.map((x) => x.premiumAmount)) : ZERO);

/** Summary cards: this month's dues (for the current filter), paid and not paid. */
export async function renewalCards(tenantId: string, policyWhere: Prisma.PolicyWhereInput, today: Date) {
  const m = monthBounds(today);
  const items = await db.renewalItem.findMany({ where: { tenantId, policy: policyWhere, dueDate: { gte: m.from, lte: m.to }, status: { in: ["Due", "Overdue", "Paid"] } }, select: { status: true, premiumAmount: true } });
  const paid = items.filter((i) => i.status === "Paid"), unpaid = items.filter((i) => i.status !== "Paid");
  return {
    due: { count: items.length, amount: total(items) },
    paid: { count: paid.length, amount: total(paid) },
    notPaid: { count: unpaid.length, amount: total(unpaid) },
  };
}

/** The rows of one Renewals tab, shared by the screen and its export. */
export async function loadRenewals(user: SessionUser, sp: Params, today: Date, take?: number) {
  await refreshOverdue(user.tenantId, today);
  const f = renewalFilter(user, sp, today);
  const include = { customer: { select: { id: true, name: true, mobile: true } } };
  const policyIn = { tenantId: user.tenantId, AND: [f.policyWhere] } satisfies Prisma.PolicyWhereInput;

  // By customer: each customer with an active matching policy – due this month, paid this financial year, overdue.
  if (f.tab === "customers") {
    const m = monthBounds(today);
    const policies = await db.policy.findMany({
      where: { ...policyIn, status: "Active" },
      include: { ...include, renewals: { where: { OR: [{ status: "Overdue" }, { dueDate: { gte: m.from, lte: m.to } }, { status: "Paid", paidOn: { gte: fyStart(today) } }] } } },
    });
    const slips = await db.ownerPaidSlip.findMany({ where: { tenantId: user.tenantId, status: "CustomerOwes", customerId: { in: [...new Set(policies.map((p) => p.customerId))] } }, select: { customerId: true, amount: true } });
    const byCustomer = new Map<string, typeof policies>();
    for (const p of policies) byCustomer.set(p.customerId, [...(byCustomer.get(p.customerId) ?? []), p]);
    const customers: CustomerRenewalRow[] = [...byCustomer.values()].map((ps) => {
      const items = ps.flatMap((p) => p.renewals);
      const owed = slips.filter((x) => x.customerId === ps[0].customerId);
      return {
        customer: ps[0].customer, policies: ps.map((p) => p.policyNumber),
        dueThisMonth: total(items.filter((i) => i.dueDate >= m.from && i.dueDate <= m.to && i.status !== "Stopped" && i.status !== "Lapsed")),
        paidThisYear: total(items.filter((i) => i.status === "Paid" && i.paidOn && i.paidOn >= fyStart(today))),
        overdue: total(items.filter((i) => i.status === "Overdue")),
        ownerPaidOwed: owed.length ? sum(owed.map((x) => x.amount)) : ZERO,
      };
    }).sort((a, b) => b.overdue.plus(b.ownerPaidOwed).comparedTo(a.overdue.plus(a.ownerPaidOwed)) || a.customer.name.localeCompare(b.customer.name)).slice(0, take);
    return { ...f, rows: [] as RenewalRow[], customers, total: customers.length ? sum(customers.map((c) => c.overdue)) : ZERO };
  }

  const [items, deposits, users] = await Promise.all([
    f.tab === "maturity" ? Promise.resolve([]) : db.renewalItem.findMany({ where: f.where, include: { policy: { include }, paidReceipt: { select: depositStatusSelect } }, orderBy: f.orderBy, take }),
    f.maturityWhere ? db.policy.findMany({ where: f.maturityWhere, include }) : Promise.resolve([]),
    userNames(user.tenantId),
  ]);
  const nameOf = nameLookup(users);
  const shown = deposits.flatMap((p) => { const date = maturityDate(p)!; return maturityShown(p, date, today, f.range) ? [{ p, date }] : []; });
  // Reminders sent, from Sent messages: maturity reminders by policy, the channel of the last renewal reminder (#24).
  const logs = await db.messageLog.findMany({
    where: {
      tenantId: user.tenantId,
      OR: [
        { relatedType: "Policy", template: "maturity_reminder", relatedId: { in: shown.map((x) => x.p.id) } },
        { relatedType: "RenewalItem", relatedId: { in: items.map((i) => i.id) } },
      ],
    },
    select: { relatedId: true, channel: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const sentFor = (id: string) => logs.filter((l) => l.relatedId === id);
  const maturities: RenewalRow[] = shown.map(({ p, date }) => {
    const sent = sentFor(p.id);
    return {
      id: `m-${p.id}`, kind: "maturity" as const, policy: p, date, amount: p.premiumAmount, status: date < today ? "Overdue" as const : "Due" as const,
      paidOn: null, paidReceiptId: null, paidReceiptNo: null, paidReceiptHref: null, collectedBy: null, companyStatus: null,
      lastReminderAt: sent[0]?.createdAt ?? null, reminderCount: sent.length, lastReminderChannel: sent[0]?.channel ?? null,
    };
  });
  const instalments: RenewalRow[] = items.map((i) => ({
    id: i.id, kind: "instalment", policy: i.policy, date: i.dueDate, amount: i.premiumAmount, status: i.status,
    paidOn: i.paidOn, paidReceiptId: i.paidReceiptId,
    paidReceiptNo: i.paidReceipt ? receiptRef(i.paidReceipt).no : null, paidReceiptHref: i.paidReceipt ? receiptRef(i.paidReceipt).href : null,
    collectedBy: i.paidReceipt ? nameOf(i.paidReceipt.createdById) : null,
    companyStatus: i.status === "Paid" ? companyStatus(i.paidReceipt, i.policy.partner, nameOf) : null, lastReminderAt: i.lastReminderAt, reminderCount: i.reminderCount,
    lastReminderChannel: sentFor(i.id)[0]?.channel ?? null,
  }));
  // Maturities are only on the Maturity tab, oldest first (past one-time deposits waiting to be marked matured on top).
  const rows = f.tab === "maturity" ? maturities.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, take) : instalments;
  // Only instalments are money to collect; a maturity is paid out by the post office.
  return { ...f, rows, customers: [] as CustomerRenewalRow[], total: instalments.length ? sum(instalments.map((i) => i.amount)) : ZERO };
}

export function renewalStatus(r: RenewalRow, today: Date): [string, Tone] {
  const days = Math.round((today.getTime() - r.date.getTime()) / 86_400_000);
  if (r.kind === "maturity") return days > 0 ? [`Matured ${days} days ago`, "red"] : [days === 0 ? "Matures today" : `Matures in ${-days} days`, "indigo"];
  if (r.status === "Paid") return ["Paid", "green"];
  if (r.status === "Overdue") return [`${overdueText(days)} overdue`, "red"];
  return [days === 0 ? "Due today" : `Due in ${-days} days`, "orange"];
}

/** Company and scheme choices for the filter, from the policies this user can see. */
export async function renewalFilterOptions(user: SessionUser, product: string, company?: string) {
  if (product === "po") return { companies: [], schemes: PO_SCHEMES.map((s) => [s, PRODUCT_SHORT[s]] as [string, string]) };
  if (product !== "insurance" && product !== "mf") return { companies: [], schemes: [] };
  const plans = await db.policy.findMany({
    where: { tenantId: user.tenantId, ...ownerScope(user), productType: product === "insurance" ? "Insurance" : "MutualFund" },
    distinct: ["partner", "productName"],
    select: { partner: true, productName: true },
    orderBy: [{ partner: "asc" }, { productName: "asc" }],
  });
  const companies = [...new Set(plans.map((p) => p.partner))];
  const schemes = [...new Set(plans.filter((p) => !company || p.partner === company).map((p) => p.productName))].map((s) => [s, s] as [string, string]);
  return { companies, schemes };
}
