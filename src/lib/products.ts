import type { CustomFieldType, Frequency, InvoiceRule, Prisma, ProductType } from "@prisma/client";
import { addMonths } from "@/lib/dates";

// Settings → Products and schemes: labels and rules shared by the settings screens, actions and seed.
// Client components import this file, so it must stay free of server-only code.

export const PRODUCT_TYPE_LABEL: Record<ProductType, string> = {
  Insurance: "Insurance", MutualFund: "Mutual fund", PoRd: "Post office RD", PoTd: "Post office TD", PoKvp: "KVP", PoNsc: "NSC",
  PoMis: "Post office MIS", PoScss: "SCSS", PoSsa: "SSA", PoPpf: "PPF",
};

export const INVOICE_RULE_LABEL: Record<InvoiceRule, string> = {
  UntilMaturity: "Per pay mode, last bill the cycle before maturity",
  UntilPremiumTerm: "Per pay mode until the premium paying term ends",
  UntilClosed: "Per pay mode until withdrawn / closed",
  None: "No bills",
};
/** Short form for tables. */
export const INVOICE_RULE_SHORT: Record<InvoiceRule, string> = {
  UntilMaturity: "Until maturity", UntilPremiumTerm: "Until premium term ends", UntilClosed: "Until closed", None: "None",
};

export const PAY_MODE_LABEL: Record<Frequency, string> = { OneTime: "One-time", Monthly: "Monthly", Quarterly: "Quarterly", HalfYearly: "Half-yearly", Yearly: "Yearly" };
export const PAY_MODES = Object.keys(PAY_MODE_LABEL) as Frequency[];

/**
 * Post office products (owner, 3 Nov 2026): the company holder CIF is asked only for these – every post office
 * scheme, plus anything sold by the company "Post Office" (Postal Life Insurance). Mutual funds have a folio instead.
 */
export const isPostal = (p: { productType: ProductType; partner: string }) => p.productType.startsWith("Po") || p.partner.trim().toLowerCase() === "post office";

/**
 * Health cover renews until it is closed (no term, no premium paying term); other insurance is life cover. Without a
 * catalogue product the quotation's product type ("Health") decides.
 */
export const isHealthCover = (p: { invoiceRule?: InvoiceRule | null; category?: string | null }) =>
  p.invoiceRule ? p.invoiceRule === "UntilClosed" : /health/i.test(p.category ?? "");

/**
 * Insurance details needed before the policy number is saved (owner, 3 Nov 2026): DOC, sum assured, plan and premium
 * for every insurance; life cover also the term and premium paying term (when the product shows it). Returns the
 * missing ones, in screen order.
 */
export function missingInsuranceDetails(p: {
  health: boolean; hasPlans: boolean; pptShown: boolean;
  startDate: unknown; sumAssured: unknown; schemeId: unknown; termMonths: unknown; premiumPayingTermMonths: unknown; premiumOk: boolean;
}): string[] {
  return [
    !p.startDate && "date of commencement (DOC)",
    !p.sumAssured && "sum assured",
    p.hasPlans && !p.schemeId && "plan",
    !p.health && !p.termMonths && "term",
    !p.health && p.pptShown && !p.premiumPayingTermMonths && "premium paying term",
    !p.premiumOk && "premium",
  ].filter((x): x is string => !!x);
}

/** Quotation product "Mutual fund" (any case, also typed under Other): SIP / Lumpsum wording, no cover. */
export const isMfCategory = (category: string) => category.trim().toLowerCase() === "mutual fund";
export const MF_PAY_MODES: Frequency[] = ["Monthly", "OneTime"];
/** SIP date choices (1–28: every month has them). */
export const SIP_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);
/** 1 → "1st", 22 → "22nd". */
export const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
/** "10th of every month". */
export const sipDateLabel = (day: number) => `${ordinal(day)} of every month`;
/** A mutual fund paid monthly is a SIP and needs a SIP date. */
export const needsSipDay = (productType: ProductType | null | undefined, frequency: Frequency | string | null | undefined) => productType === "MutualFund" && frequency === "Monthly";
export const payModeLabel = (m: Frequency, mf: boolean) => (mf && m === "Monthly" ? "SIP (monthly)" : mf && m === "OneTime" ? "Lumpsum" : PAY_MODE_LABEL[m]);

/** Fields an account / policy of this product can show. */
export const ACCOUNT_FIELDS = {
  policyNumber: "Policy / account number",
  commencement: "Date of commencement",
  maturity: "Maturity date (auto from tenure)",
  premiumPayingTerm: "Premium paying term",
  nominee: "Nominee",
} as const;
export type AccountField = keyof typeof ACCOUNT_FIELDS;

/** Bank details asked for when a product needs them (stored encrypted once accounts are added – phase 3). */
export const BANK_FIELDS = {
  holder: "Account holder",
  bank: "Bank",
  branch: "Branch",
  ifsc: "IFSC",
  micr: "MICR code",
  accountNo: "Account number",
  accountType: "Account type",
} as const;
export type BankField = keyof typeof BANK_FIELDS;

export const CUSTOM_FIELD_TYPE_LABEL: Record<CustomFieldType, string> = { Text: "Text", Number: "Number", Date: "Date", Dropdown: "Dropdown" };

/** "5 years", "115 months", "1 yr renewable". */
export function fmtTenure(months: number | null | undefined) {
  if (!months) return "Open-ended / renewable";
  if (months % 12 === 0) return `${months / 12} year${months === 12 ? "" : "s"}`;
  return `${months} months`;
}

export const fmtLockIn = (months: number | null | undefined) => (months ? fmtTenure(months) : "—");

type Rate = { rate: Prisma.Decimal; effectiveFrom: Date };

/** The rate in force on `on` (latest effective-from not after it), or null. */
export function rateOn<R extends Rate>(rates: R[], on: Date): R | null {
  return [...rates].filter((r) => r.effectiveFrom <= on).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null;
}

/** History newest first, each with the day before the next rate began as its end. */
export function rateHistory<R extends Rate>(rates: R[]) {
  const sorted = [...rates].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  return sorted.map((r, i) => ({ ...r, to: i === 0 ? null : new Date(sorted[i - 1].effectiveFrom.getTime() - 86_400_000) }));
}

/** Lock-in ends this many months after the start; before that a premature closure is refused. */
export const lockInUntil = (startDate: Date, lockInMonths: number | null | undefined) => (lockInMonths ? addMonths(startDate, lockInMonths) : null);
