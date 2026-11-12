import type { Prisma } from "@prisma/client";
import { fmtDate } from "@/lib/dates";

// Has the money collected from the customer reached the company (insurer, AMC, post office)?
// Shared by Renewals (Paid tab), Receipts (list, detail) and their exports so they always agree.

/** `payable` = can go in "Pay to company"; RD is deposited through a PO deposit instead (`rdDepositable`). */
export type CompanyStatus = { state: "pending" | "paid"; text: string; payable: boolean };

export const depositStatusSelect = {
  id: true, receiptNo: true, status: true, ownerPaid: true, rdStatus: true, createdById: true,
  payment: { select: { id: true, paymentNo: true } }, // paid with other dues: the customer holds this AA- number
  companyPayment: { select: { paidOn: true, reference: true, createdById: true } },
  poDepositLine: { select: { poDeposit: { select: { depositDate: true, poReceiptNo: true, createdById: true } } } },
} satisfies Prisma.ReceiptSelect;
export type DepositReceipt = Prisma.ReceiptGetPayload<{ select: typeof depositStatusSelect }>;

/**
 * `company` is the policy's partner (LIC, Star Health, Post Office…); a null receipt is an owner-paid instalment.
 * With `nameOf`, a paid status ends with who recorded the deposit ("· by Arun").
 */
export function companyStatus(r: DepositReceipt | null, company: string, nameOf?: (userId: string) => string): CompanyStatus {
  if (!r || r.ownerPaid) return { state: "paid", text: `Paid to ${company} by owner`, payable: false };
  const by = (id: string) => (nameOf ? ` · by ${nameOf(id)}` : "");
  const cp = r.companyPayment;
  if (cp) return { state: "paid", text: `Paid to ${company} · ${fmtDate(cp.paidOn)} · ref ${cp.reference}${by(cp.createdById)}`, payable: false };
  const deposit = r.poDepositLine?.poDeposit;
  if (deposit) return { state: "paid", text: `Paid to ${company} · ${fmtDate(deposit.depositDate)} · PO ${deposit.poReceiptNo}${by(deposit.createdById)}`, payable: false };
  if (r.rdStatus) return { state: "pending", text: `Pending with ${company} · RD deposit`, payable: false };
  return { state: "pending", text: `Pending with ${company}`, payable: r.status === "Saved" };
}

/** Display name for a user id, from `userNames()` ("—" if unknown). */
export const nameLookup = (users: { id: string; name: string }[]) => (id: string | null | undefined) => users.find((u) => u.id === id)?.name ?? "—";

/** RD money still to be taken to the post office (Day Book PO deposit, or one receipt from its own page). */
export const rdDepositable = (r: Pick<DepositReceipt, "status" | "ownerPaid" | "rdStatus">) =>
  r.status === "Saved" && !r.ownerPaid && r.rdStatus === "Collected";

/** Receipts list filter: pending = collected for a policy but not yet with the company. */
export const DEPOSIT_WHERE: Record<"pending" | "paid", Prisma.ReceiptWhereInput> = {
  pending: { status: "Saved", ownerPaid: false, policyId: { not: null }, OR: [{ rdStatus: "Collected" }, { rdStatus: null, companyPaymentId: null }] },
  paid: { policyId: { not: null }, OR: [{ ownerPaid: true }, { rdStatus: { in: ["Deposited", "Verified"] } }, { companyPaymentId: { not: null } }] },
};
