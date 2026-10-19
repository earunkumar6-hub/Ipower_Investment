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
  receipt: "Receipt",
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

export function customerFilter(user: SessionUser, sp: Params) {
  const q = sp.q?.trim();
  const where: Prisma.CustomerWhereInput = {
    tenantId: user.tenantId,
    ...ownerScope(user),
    ...(q && { OR: [{ name: { contains: q, mode: "insensitive" } }, { mobile: { contains: q } }, { policies: { some: { policyNumber: { contains: q, mode: "insensitive" } } } }] }),
  };
  return { q, where };
}

export const RENEWAL_TABS = [["due", "Due"], ["overdue", "Overdue"], ["paid", "Paid"]] as const;
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
  const tab = RENEWAL_TABS.find(([k]) => k === sp.tab)?.[0] ?? "due";
  const product = RENEWAL_PRODUCTS.find(([k]) => k === sp.product)?.[0] ?? "all";
  const byCompany = product === "insurance" || product === "mf";
  const company = byCompany ? sp.company || undefined : undefined;
  const plan = byCompany ? sp.scheme || undefined : undefined;
  const poScheme = product === "po" ? PO_SCHEMES.find((s) => s === sp.scheme) : undefined;
  const scheme = plan ?? poScheme;
  const within = Math.min(Math.max(Number(sp.within) || 30, 1), 365);
  const paidTo = tab === "paid" ? (PAID_TO.find(([k]) => k === sp.paidto)?.[0] ?? "all") : "all";
  const policyWhere: Prisma.PolicyWhereInput = {
    ...ownerScope(user),
    ...(product === "insurance" && { productType: "Insurance" }),
    ...(product === "mf" && { productType: "MutualFund" }),
    ...(product === "po" && { productType: poScheme ?? { in: [...PO_SCHEMES] } }),
    ...(company && { partner: company }),
    ...(plan && { productName: plan }),
  };
  // Active one-time deposits matching the filter; the maturity date is worked out by the caller.
  const showMaturity = tab !== "paid" && (product === "all" || (product === "po" && (!poScheme || MATURITY_SCHEMES.includes(poScheme))));
  const maturityWhere: Prisma.PolicyWhereInput | null = showMaturity
    ? { tenantId: user.tenantId, AND: [policyWhere, { productType: { in: MATURITY_SCHEMES } }], status: "Active", termMonths: { not: null } }
    : null;
  const filterLabel = [RENEWAL_PRODUCTS.find(([k]) => k === product)?.[1], company, poScheme ? PRODUCT_SHORT[poScheme] : plan].filter(Boolean).join(" · ")
    + (paidTo === "all" ? "" : ` · ${paidTo === "pending" ? "not yet paid" : "paid"} to Post office / insurer`);
  const where: Prisma.RenewalItemWhereInput = {
    tenantId: user.tenantId,
    policy: policyWhere,
    ...(tab === "due" && { status: "Due", dueDate: { lt: addDays(today, within) } }),
    ...(tab === "overdue" && { status: "Overdue" }),
    // Pending money is listed however old it is; otherwise the Paid tab covers the last 30 days.
    ...(tab === "paid" && { status: "Paid", ...(paidTo !== "pending" && { paidOn: { gte: addDays(today, -30) } }) }),
    ...(paidTo !== "all" && PAID_TO_WHERE[paidTo]),
  };
  const orderBy: Prisma.RenewalItemOrderByWithRelationInput = tab === "paid" ? { paidOn: "desc" } : { dueDate: "asc" };
  return { tab, product, company, scheme, paidTo, within, where, orderBy, maturityWhere, filterLabel };
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
