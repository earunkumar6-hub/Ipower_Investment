import type { LeadSource, LeadStatus, OwnerPaidSlipStatus, Prisma, ProductType } from "@prisma/client";
import type { Tone } from "@/components/status-badge";
import { addDays } from "@/lib/dates";
import { LEAD_SOURCE_LABEL, LEAD_STATUS_LABEL } from "@/lib/lead-labels";
import { ownerScope } from "@/lib/leads";
import { seesAll } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";

// Search-param parsing, query filters and labels shared by each list screen and its Excel
// export, so a download always holds the rows the screen is showing (without the row cap).

export type Params = Record<string, string | undefined>;

export const PRODUCT_SHORT: Record<ProductType, string> = { Insurance: "Insurance", MutualFund: "MF", PoRd: "RD", PoTd: "TD", PoKvp: "KVP", PoNsc: "NSC", PoMis: "MIS", PoScss: "SCSS", PoSsa: "SSA", PoPpf: "PPF" };

export const MESSAGE_TEMPLATE: Record<string, string> = {
  kyc_consent_link: "KYC consent link",
  maturity_reminder: "Maturity reminder",
  receipt: "Receipt",
  receipt_share: "Receipt shared",
  direct_bill: "Direct bill",
  renewal_reminder: "Renewal reminder",
  low_wallet_balance: "Low wallet balance",
};

export const SLIP_STATUS: Record<OwnerPaidSlipStatus, [string, Tone]> = {
  CustomerOwes: ["Owner paid – customer owes", "indigo"],
  CollectedReturnToOwner: ["Collected – return to owner", "orange"],
  Settled: ["Settled", "green"],
  Cancelled: ["Cancelled", "slate"],
};

export const monthLabel = (d: Date) => d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

export function leadFilter(user: SessionUser, sp: Params) {
  const status = sp.status && sp.status in LEAD_STATUS_LABEL ? (sp.status as LeadStatus) : undefined;
  const source = sp.source && sp.source in LEAD_SOURCE_LABEL ? (sp.source as LeadSource) : undefined;
  const q = sp.q?.trim();
  const where: Prisma.LeadWhereInput = {
    tenantId: user.tenantId,
    ...ownerScope(user),
    ...(status && { status }),
    ...(source && { source }),
    ...(q && {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { mobiles: { some: { number: { contains: q } } } },
        { leadNo: { contains: q, mode: "insensitive" } },
      ],
    }),
  };
  return { status, source, q, where };
}

export const HOLDING_STATUS = [["all", "All"], ["Active", "Active"], ["Matured", "Matured"], ["PrematureClosed", "Premature closed"], ["Withdrawn", "Withdrawn"], ["Lapsed", "Lapsed"]] as const;

/**
 * Customers list: search (name, any mobile, policy no.) and a holdings filter – product → company → scheme
 * (same choices as Renewals) and the holding's status. `holdingWhere` marks which holdings matched.
 */
export function customerFilter(user: SessionUser, sp: Params) {
  const q = sp.q?.trim();
  const product = RENEWAL_PRODUCTS.find(([k]) => k === sp.product)?.[0] ?? "all";
  const byCompany = product === "insurance" || product === "mf";
  const company = byCompany ? sp.company || undefined : undefined;
  const plan = byCompany ? sp.scheme || undefined : undefined;
  const poScheme = product === "po" ? PO_SCHEMES.find((s) => s === sp.scheme) : undefined;
  const status = HOLDING_STATUS.find(([k]) => k === sp.status)?.[0] ?? "all";
  const holdingWhere: Prisma.PolicyWhereInput = {
    ...(product === "insurance" && { productType: "Insurance" }),
    ...(product === "mf" && { productType: "MutualFund" }),
    ...(product === "po" && { productType: poScheme ?? { in: [...PO_SCHEMES] } }),
    ...(company && { partner: company }),
    ...(plan && { productName: plan }),
    ...(status !== "all" && { status }),
  };
  const filtered = Object.keys(holdingWhere).length > 0;
  const where: Prisma.CustomerWhereInput = {
    tenantId: user.tenantId,
    ...ownerScope(user),
    ...(q && { OR: [{ name: { contains: q, mode: "insensitive" } }, { cifNo: { contains: q, mode: "insensitive" } }, { mobiles: { some: { number: { contains: q } } } }, { policies: { some: { policyNumber: { contains: q, mode: "insensitive" } } } }] }),
    ...(filtered && { policies: { some: holdingWhere } }),
  };
  const filterLabel = [
    product !== "all" && RENEWAL_PRODUCTS.find(([k]) => k === product)?.[1], company, poScheme ? PRODUCT_SHORT[poScheme] : plan,
    status !== "all" && HOLDING_STATUS.find(([k]) => k === status)?.[1],
  ].filter(Boolean).join(" · ");
  return { q, product, company, scheme: plan ?? poScheme, status, where, holdingWhere, filtered, filterLabel };
}

export const RENEWAL_TABS = [["due", "Due"], ["overdue", "Overdue"], ["paid", "Paid"], ["notrenewed", "Not renewed"], ["customers", "By customer"]] as const;
export type RenewalTab = (typeof RENEWAL_TABS)[number][0];

/** Quick picks for the Renewals date range. */
export const RANGE_PICKS = [["today", "Today"], ["week", "This week"], ["month", "This month"], ["next30", "Next 30 days"], ["next3m", "Next 3 months"], ["lastmonth", "Last month"]] as const;

const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const monthEndOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
const isoDay = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : undefined);

/** Inclusive date range for a quick pick (weeks run Monday–Sunday). */
export function pickRange(key: string, today: Date): { from: Date; to: Date } | null {
  switch (key) {
    case "today": return { from: today, to: today };
    case "week": { const mon = addDays(today, -((today.getUTCDay() + 6) % 7)); return { from: mon, to: addDays(mon, 6) }; }
    case "month": return { from: monthStart(today), to: monthEndOf(today) };
    case "next30": return { from: today, to: addDays(today, 29) };
    case "next3m": return { from: today, to: addDays(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 3, today.getUTCDate())), -1) };
    case "lastmonth": { const last = monthStart(addDays(monthStart(today), -1)); return { from: last, to: monthEndOf(last) }; }
    default: return null;
  }
}

/**
 * The Renewals date range: From / To, else a quick pick, else the old `within` days, else the tab's default
 * (Due: next 30 days · Paid: last 30 days · Not renewed: this month · Overdue / By customer: no limit).
 */
export function renewalRange(tab: RenewalTab, sp: Params, today: Date): { from: Date; to: Date; pick: string } | null {
  const from = isoDay(sp.from), to = isoDay(sp.to);
  if (from || to) return { from: from ?? new Date(Date.UTC(2000, 0, 1)), to: to ?? new Date(Date.UTC(2100, 0, 1)), pick: "custom" };
  const pick = RANGE_PICKS.find(([k]) => k === sp.range)?.[0];
  if (pick) return { ...pickRange(pick, today)!, pick };
  if (sp.within) {
    const days = Math.min(Math.max(Number(sp.within) || 30, 1), 365);
    return { from: today, to: addDays(today, days - 1), pick: "within" };
  }
  if (tab === "due") return { ...pickRange("next30", today)!, pick: "next30" };
  if (tab === "paid") return { from: addDays(today, -29), to: today, pick: "last30" };
  if (tab === "notrenewed") return { ...pickRange("month", today)!, pick: "month" };
  return null;
}

/** "1 Oct – 31 Oct 2026" */
export const rangeLabel = (r: { from: Date; to: Date } | null) => {
  if (!r) return "any date";
  const f = (d: Date, year: boolean) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(year && { year: "numeric" }), timeZone: "UTC" });
  return r.from.getTime() === r.to.getTime() ? f(r.from, true) : `${f(r.from, r.from.getUTCFullYear() !== r.to.getUTCFullYear())} – ${f(r.to, true)}`;
};
export const RENEWAL_PRODUCTS = [["all", "All products"], ["insurance", "Insurance"], ["po", "Post office"], ["mf", "Mutual fund"]] as const;
export const PAID_TO = [["all", "All"], ["pending", "Pending"], ["paid", "Paid"]] as const;
/** Paid tab: has the money collected from the customer reached the company (insurer, AMC, post office)? */
const PAID_TO_WHERE: Record<"pending" | "paid", Prisma.RenewalItemWhereInput> = {
  // RD waits for the Day Book PO deposit; everything else for "Pay to company".
  pending: { paidReceipt: { status: "Saved", ownerPaid: false, OR: [{ rdStatus: "Collected" }, { rdStatus: null, companyPaymentId: null }] } },
  paid: { OR: [{ paidReceiptId: null }, { paidReceipt: { OR: [{ ownerPaid: true }, { rdStatus: { in: ["Deposited", "Verified"] } }, { companyPaymentId: { not: null } }] } }] },
};

/** Post office schemes, in the order the scheme filter lists them. */
export const PO_SCHEMES = ["PoRd", "PoTd", "PoMis", "PoScss", "PoSsa", "PoPpf", "PoNsc", "PoKvp"] as const satisfies readonly ProductType[];
/** One-time deposits: nothing falls due again, so Renewals reminds about their maturity instead. */
export const MATURITY_SCHEMES: ProductType[] = ["PoTd", "PoMis", "PoScss", "PoNsc", "PoKvp"];

/**
 * Product → company → scheme. Company and scheme are the insurer/AMC and plan for insurance
 * and mutual funds; for the post office the scheme is the product type (RD, TD, SSA…).
 */
export function renewalFilter(user: SessionUser, sp: Params, today: Date) {
  const tab: RenewalTab = RENEWAL_TABS.find(([k]) => k === sp.tab)?.[0] ?? "due";
  const product = RENEWAL_PRODUCTS.find(([k]) => k === sp.product)?.[0] ?? "all";
  const byCompany = product === "insurance" || product === "mf";
  const company = byCompany ? sp.company || undefined : undefined;
  const plan = byCompany ? sp.scheme || undefined : undefined;
  const poScheme = product === "po" ? PO_SCHEMES.find((s) => s === sp.scheme) : undefined;
  const scheme = plan ?? poScheme;
  const range = renewalRange(tab, sp, today);
  const paidTo = tab === "paid" ? (PAID_TO.find(([k]) => k === sp.paidto)?.[0] ?? "all") : "all";
  const policyWhere: Prisma.PolicyWhereInput = {
    ...ownerScope(user),
    ...(product === "insurance" && { productType: "Insurance" }),
    ...(product === "mf" && { productType: "MutualFund" }),
    ...(product === "po" && { productType: poScheme ?? { in: [...PO_SCHEMES] } }),
    ...(company && { partner: company }),
    ...(plan && { productName: plan }),
  };
  // Maturity reminders (owner, 20 Oct 2026: every scheme with a maturity, from a month before – the Due tab's
  // default range). Health renews until closed and mutual funds are open-ended, so they have none. After
  // maturity only one-time deposits stay listed (Overdue, until "Mark matured"); billed policies mature by themselves.
  const maturityWhere: Prisma.PolicyWhereInput | null = tab === "due" || tab === "overdue"
    ? {
        tenantId: user.tenantId, AND: [policyWhere, tab === "overdue" ? { productType: { in: MATURITY_SCHEMES } } : { productType: { not: "MutualFund" } }],
        status: "Active", termMonths: { not: null }, NOT: { product: { invoiceRule: "UntilClosed" } },
      }
    : null;
  const filterLabel = [RENEWAL_PRODUCTS.find(([k]) => k === product)?.[1], company, poScheme ? PRODUCT_SHORT[poScheme] : plan, range && rangeLabel(range)].filter(Boolean).join(" · ")
    + (paidTo === "all" ? "" : ` · ${paidTo === "pending" ? "not yet paid" : "paid"} to Post office / insurer`);
  const where: Prisma.RenewalItemWhereInput = {
    tenantId: user.tenantId,
    policy: policyWhere,
    ...(tab === "due" && { status: "Due", ...(range && { dueDate: { gte: range.from, lte: range.to } }) }),
    ...(tab === "overdue" && { status: "Overdue", ...(range && { dueDate: { gte: range.from, lte: range.to } }) }),
    // Pending money is listed however old it is; otherwise the Paid tab covers the date range (default last 30 days).
    ...(tab === "paid" && { status: "Paid", ...(paidTo !== "pending" && range && { paidOn: { gte: range.from, lte: range.to } }) }),
    ...(paidTo !== "all" && PAID_TO_WHERE[paidTo]),
  };
  const orderBy: Prisma.RenewalItemOrderByWithRelationInput = tab === "paid" ? { paidOn: "desc" } : { dueDate: "asc" };
  return { tab, product, company, scheme, paidTo, range, policyWhere, where, orderBy, maturityWhere, filterLabel };
}

export const EXPENSE_TABS = [["all", "All"], ["approve", "Waiting for my approval"], ["repay", "To be repaid"]] as const;

/** The "approve" tab is narrowed further with canApprove() after the query. */
export function expenseFilter(user: SessionUser, sp: Params) {
  const tab = EXPENSE_TABS.find(([k]) => k === sp.tab)?.[0] ?? "all";
  const where: Prisma.ExpenseWhereInput = {
    tenantId: user.tenantId,
    ...(seesAll(user.role) ? {} : { createdById: user.id }),
    ...(tab === "approve" && { status: "Waiting" as const }),
    ...(tab === "repay" && { repaymentStatus: "ToBeRepaid" as const, status: { in: ["Saved" as const, "Approved" as const] } }),
  };
  return { tab, where };
}

export const receiptTab = (sp: Params) => (sp.tab === "owner" ? "owner" : "customer");
/** Receipts list: has the money reached the company? (see `DEPOSIT_WHERE`) */
export const depositFilter = (sp: Params) => (sp.deposit === "pending" || sp.deposit === "paid" ? sp.deposit : "all");

/** A past or today's date from ?date=YYYY-MM-DD; anything else is today. */
export function dayBookDate(sp: Params, today: Date) {
  const requested = sp.date;
  return requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && new Date(`${requested}T00:00:00Z`) <= today ? new Date(`${requested}T00:00:00Z`) : today;
}

/** A month key up to the current one from ?month=YYYY-MM; anything else is the current month. */
export function pnlMonth(sp: Params, current: string) {
  const requested = sp.month;
  return requested && /^\d{4}-\d{2}$/.test(requested) && requested <= current ? requested : current;
}
