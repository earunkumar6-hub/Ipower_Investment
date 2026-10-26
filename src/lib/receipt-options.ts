import type { InvoiceRule, Prisma, RenewalItem } from "@prisma/client";
import { fmtDate, isoDate } from "@/lib/dates";
import { payableDues } from "@/lib/dues";
import { billEnd } from "@/lib/policies";

// Bills offered on the receipt screens (one customer, combined, bill group), oldest first per policy.

const monthLabel = (d: Date) => d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

export type DueTag = "Overdue" | "Due" | "Advance";
/** `dues`: payable bills oldest first (unpaid, then advance up to 12 months ahead); advance bills get a BL- number when raised or paid. */
export type PolicyOption = {
  id: string; label: string; customer: string;
  /** Last bill paid ("Sep 2027" / "7 Oct 2027"), shown when nothing is left to pay. */
  paidUntil?: string | null;
  dues: { itemId: string | null; billNo: string | null; label: string; date: string; amount: string; tag: DueTag }[];
};

type PolicyWithBills = Prisma.PolicyGetPayload<{ include: { customer: { select: { name: true } } } }> & {
  renewals: RenewalItem[]; product: { invoiceRule: InvoiceRule } | null;
};

/** `openOnly`: bills already raised (stored), no advance instalments – the combined receipt. */
export function policyOptions(policies: PolicyWithBills[], today: Date, openOnly = false): PolicyOption[] {
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const withDues = policies.map((p) => ({
    p, dues: payableDues({ ...p, billUntil: billEnd(p, p.product?.invoiceRule) }, p.renewals, today).filter((d) => !openOnly || d.itemId),
  }));
  const firstDue = (x: (typeof withDues)[number]) => x.dues[0]?.dueDate.getTime() ?? Infinity;
  const dateLabel = (p: PolicyWithBills, d: Date) => (p.frequency === "Monthly" ? monthLabel(d) : fmtDate(d));
  const paidUntil = (p: PolicyWithBills) => {
    const last = p.renewals.filter((r) => r.status === "Paid").reduce<Date | null>((m, r) => (!m || r.dueDate > m ? r.dueDate : m), null);
    return last ? dateLabel(p, last) : null;
  };
  return withDues.sort((a, b) => firstDue(a) - firstDue(b)).map(({ p, dues }) => ({
    id: p.id,
    customer: p.customer.name,
    paidUntil: paidUntil(p),
    label: p.productType === "PoRd" ? `${p.policyNumber} · Post office RD` : `${p.partner} ${p.productName} · ${p.policyNumber}`,
    dues: dues.map((d) => ({
      itemId: d.itemId,
      billNo: p.renewals.find((r) => r.id === d.itemId)?.billNo ?? null,
      amount: d.amount.toFixed(2),
      date: isoDate(d.dueDate),
      label: dateLabel(p, d.dueDate),
      tag: d.dueDate < today ? "Overdue" : d.dueDate > monthEnd ? "Advance" : "Due",
    })),
  }));
}

/** What the receipt screens include with each policy. */
export const POLICY_BILLS_INCLUDE = {
  renewals: true,
  product: { select: { invoiceRule: true } },
  customer: { select: { name: true, ownerId: true } },
} satisfies Prisma.PolicyInclude;

/** Ticks for bills picked elsewhere (Renewals → "One combined receipt"): bills are paid oldest first per policy,
 * so ticking a later bill ticks the older ones of that policy too. */
export function presetCounts(policies: PolicyOption[], billIds: string[]): Record<string, number> {
  const want = new Set(billIds);
  return Object.fromEntries(policies.flatMap((p) => {
    const last = p.dues.reduce((m, d, i) => (d.itemId && want.has(d.itemId) ? i : m), -1);
    return last >= 0 ? [[p.id, last + 1] as const] : [];
  }));
}
