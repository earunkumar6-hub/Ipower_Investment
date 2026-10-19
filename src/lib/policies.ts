import type { Frequency, InvoiceRule, Prisma, ProductType } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { renewalDueDates } from "@/lib/renewals";

// One place that turns policy details into a Policy and its renewal schedule: used when a proposal's policy
// number is entered and by "Add product directly". Renewals are stored for the next 12 months (dues.ts
// continues the series for advance payments); products without bills get none.

export type PolicyInput = {
  tenantId: string; customerId: string; ownerId: string; proposalId?: string; policyNumber: string;
  productType: ProductType; partner: string; productName: string; productId?: string | null; schemeId?: string | null;
  premiumAmount: Prisma.Decimal.Value; frequency: Frequency; startDate: Date; termMonths?: number | null; sumAssured?: Prisma.Decimal.Value | null;
  premiumPayingTermMonths?: number | null; nominee?: string | null; rateAtOpen?: Prisma.Decimal.Value | null;
  customValues?: Prisma.InputJsonValue | null; bankDetailsEnc?: string | null;
  /** From Settings → Products and schemes; without it every non-one-time policy gets bills. */
  invoiceRule?: InvoiceRule | null;
};

export async function createPolicyWithSchedule(tx: Tx, p: PolicyInput) {
  const { invoiceRule, customValues, ...data } = p;
  const policy = await tx.policy.create({ data: { ...data, ...(customValues && { customValues }) } });
  const billed = invoiceRule ? invoiceRule !== "None" : p.productType !== "MutualFund";
  // Bills stop when the premium paying term ends (life) – otherwise at the end of the term.
  const billMonths = invoiceRule === "UntilPremiumTerm" ? p.premiumPayingTermMonths ?? p.termMonths : p.termMonths;
  // The first payment is taken at the start; renewals are the ones after it and end before the term does
  // (Yearly × 3 years = 2 renewals; RD's last bill is the month before maturity).
  const dues = billed ? renewalDueDates(p.startDate, p.frequency, billMonths ? billMonths - 1 : null) : [];
  if (dues.length) {
    await tx.renewalItem.createMany({ data: dues.map((dueDate) => ({ tenantId: p.tenantId, policyId: policy.id, dueDate, premiumAmount: p.premiumAmount })) });
  }
  return policy;
}
