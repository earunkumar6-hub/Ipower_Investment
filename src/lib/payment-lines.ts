import type { Frequency, RenewalItem } from "@prisma/client";
import { fmtDate } from "@/lib/dates";
import { canActOn } from "@/lib/leads";
import { seesAll } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";

const monthLabel = (d: Date) => d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

/** "Nov 2026" for monthly instalments, "15 Oct 2026" otherwise; "—" for a payment with no instalment. */
export function dueLabel(r: { renewalItemId: string | null; policy: { frequency: Frequency } | null }, items: Pick<RenewalItem, "id" | "dueDate">[]) {
  const item = items.find((i) => i.id === r.renewalItemId);
  if (!item) return "—";
  return r.policy?.frequency === "Monthly" ? monthLabel(item.dueDate) : fmtDate(item.dueDate);
}

/** The receipt number the customer holds for a paid bill: the one AA- receipt when it was paid with other dues (older: PAY-), else its own receipt. */
export const receiptRef = (r: { id: string; receiptNo: string; payment?: { id: string; paymentNo: string } | null }) =>
  r.payment ? { no: r.payment.paymentNo, href: `/payments/${r.payment.id}` } : { no: r.receiptNo, href: `/receipts/${r.id}` };

/** Who may open a payment: Admin / Super Admin, whoever entered it, or the owner of a customer on one of its lines. */
export const canSeePayment = (user: SessionUser, p: { createdById: string; receipts: { customer: { ownerId: string } }[] }) =>
  seesAll(user.role) || p.createdById === user.id || p.receipts.some((r) => canActOn(user, r.customer.ownerId));

/** Who the payment receipt is made out to: the customer, or the "Paid by" person on combined / bill-group receipts. */
export const payerOf = (p: { payerName: string | null; payerMobile: string | null; customer: { name: string; mobile: string } | null }) =>
  ({ name: p.customer?.name ?? p.payerName ?? "—", mobile: p.customer?.mobile ?? p.payerMobile ?? "" });
