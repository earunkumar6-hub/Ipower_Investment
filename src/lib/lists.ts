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

export const PRODUCT_SHORT: Record<ProductType, string> = { Insurance: "Insurance", MutualFund: "MF", PoRd: "RD", PoTd: "TD", PoKvp: "KVP", PoNsc: "NSC" };

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
        { mobile: { contains: q } },
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
export const RENEWAL_TYPES = [["all", "All products"], ["insurance", "Insurance"], ["rd", "Post office RD"]] as const;

export function renewalFilter(user: SessionUser, sp: Params, today: Date) {
  const tab = RENEWAL_TABS.find(([k]) => k === sp.tab)?.[0] ?? "due";
  const type = RENEWAL_TYPES.find(([k]) => k === sp.type)?.[0] ?? "all";
  const within = Math.min(Math.max(Number(sp.within) || 30, 1), 365);
  const policyWhere: Prisma.PolicyWhereInput = {
    ...ownerScope(user),
    ...(type === "insurance" && { productType: "Insurance" }),
    ...(type === "rd" && { productType: "PoRd" }),
  };
  const where: Prisma.RenewalItemWhereInput = {
    tenantId: user.tenantId,
    policy: policyWhere,
    ...(tab === "due" && { status: "Due", dueDate: { lt: addDays(today, within) } }),
    ...(tab === "overdue" && { status: "Overdue" }),
    ...(tab === "paid" && { status: "Paid", paidOn: { gte: addDays(today, -30) } }),
  };
  const orderBy: Prisma.RenewalItemOrderByWithRelationInput = tab === "paid" ? { paidOn: "desc" } : { dueDate: "asc" };
  return { tab, type, within, where, orderBy };
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
