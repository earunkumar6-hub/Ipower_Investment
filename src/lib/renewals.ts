import type { Frequency, Policy, Prisma, RenewalStatus } from "@prisma/client";
import type { Tone } from "@/components/status-badge";
import { addDays, addMonths } from "@/lib/dates";
import { db } from "@/lib/db";
import { ownerScope } from "@/lib/leads";
import { PO_SCHEMES, PRODUCT_SHORT, renewalFilter, type Params } from "@/lib/lists";
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

/** Unpaid instalments whose due date has passed become Overdue (run before reading renewals). */
export async function refreshOverdue(tenantId: string, today: Date) {
  await db.renewalItem.updateMany({ where: { tenantId, status: "Due", dueDate: { lt: today } }, data: { status: "Overdue" } });
}

export const maturityDate = (p: Pick<Policy, "startDate" | "termMonths">) => (p.termMonths ? addMonths(p.startDate, p.termMonths) : null);

type RowPolicy = Policy & { customer: { id: string; name: string } };
/** An instalment to collect, or the maturity of a one-time post office deposit (a reminder only). */
export type RenewalRow = {
  id: string;
  kind: "instalment" | "maturity";
  policy: RowPolicy;
  date: Date;
  amount: Prisma.Decimal; // instalment, or the deposited amount for a maturity
  status: RenewalStatus;
  paidOn: Date | null;
  paidReceiptId: string | null;
  lastReminderAt: Date | null;
};

/** The rows of one Renewals tab, shared by the screen and its export. */
export async function loadRenewals(user: SessionUser, sp: Params, today: Date, take?: number) {
  await refreshOverdue(user.tenantId, today);
  const f = renewalFilter(user, sp, today);
  const include = { customer: { select: { id: true, name: true } } };
  const [items, deposits] = await Promise.all([
    db.renewalItem.findMany({ where: f.where, include: { policy: { include } }, orderBy: f.orderBy, take }),
    f.maturityWhere ? db.policy.findMany({ where: f.maturityWhere, include }) : Promise.resolve([]),
  ]);
  const end = addDays(today, f.within);
  const maturities: RenewalRow[] = deposits.flatMap((p) => {
    const date = maturityDate(p)!;
    const show = f.tab === "due" ? date >= today && date < end : date < today;
    return show ? [{ id: `m-${p.id}`, kind: "maturity" as const, policy: p, date, amount: p.premiumAmount, status: f.tab === "due" ? "Due" as const : "Overdue" as const, paidOn: null, paidReceiptId: null, lastReminderAt: null }] : [];
  });
  const instalments: RenewalRow[] = items.map((i) => ({
    id: i.id, kind: "instalment", policy: i.policy, date: i.dueDate, amount: i.premiumAmount, status: i.status,
    paidOn: i.paidOn, paidReceiptId: i.paidReceiptId, lastReminderAt: i.lastReminderAt,
  }));
  // Paid rows keep their paid-on order; maturities only appear on Due / Overdue.
  const rows = maturities.length ? [...instalments, ...maturities].sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, take) : instalments;
  // Only instalments are money to collect; a maturity is paid out by the post office.
  const total = instalments.length ? sum(instalments.map((i) => i.amount)) : ZERO;
  return { ...f, rows, total };
}

export function renewalStatus(r: RenewalRow, today: Date): [string, Tone] {
  const days = Math.round((today.getTime() - r.date.getTime()) / 86_400_000);
  if (r.kind === "maturity") return days > 0 ? [`Matured ${days} days ago`, "red"] : [days === 0 ? "Matures today" : `Matures in ${-days} days`, "indigo"];
  if (r.status === "Paid") return ["Paid", "green"];
  if (r.status === "Overdue") return [`${days} days overdue`, "red"];
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
