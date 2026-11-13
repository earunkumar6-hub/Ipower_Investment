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

/**
 * Quotation "Product" list (owner change list #12, 13 Nov 2026): the categories of the active products in Settings →
 * Products and schemes (`Product.category`), no longer a Dropdown values list. Typing a new category on a product adds
 * a new group. The starting four, also used when a product's category is left blank: Mutual fund; Post office = every
 * Po* scheme and anything from the company "Post Office" (PLI); Health insurance = insurance billed until closed;
 * Life insurance = other insurance.
 */
export const QUOTE_GROUPS = ["Life insurance", "Health insurance", "Mutual fund", "Post office"] as const;
type GroupInput = { productType: ProductType; partner: string; invoiceRule: InvoiceRule; category?: string | null };
export const defaultQuoteGroup = (p: GroupInput): string =>
  p.productType === "MutualFund" ? "Mutual fund" : isPostal(p) ? "Post office" : p.invoiceRule === "UntilClosed" ? "Health insurance" : "Life insurance";
/** The product's category, or the starting one for its kind when none is set. */
export const quoteGroup = (p: GroupInput): string => p.category?.trim() || defaultQuoteGroup(p);
/** Categories in list order: the starting four first, then any added later (A–Z). */
export const orderGroups = (names: Iterable<string>) => {
  const set = [...new Set(names)];
  const rank = (g: string) => { const i = (QUOTE_GROUPS as readonly string[]).indexOf(g); return i < 0 ? QUOTE_GROUPS.length : i; };
  return set.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
};

/** Quotation product "Mutual fund" (any case): SIP / Lumpsum wording, no cover. */
export const isMfCategory = (category: string) => category.trim().toLowerCase() === "mutual fund";
export const MF_PAY_MODES: Frequency[] = ["Monthly", "OneTime"];
/**
 * Quotation product "Post office" follows the plan chosen: PLI (Postal Life Insurance) is the only insurance – it keeps
 * the sum insured and needs a premium. Every other plan (RD, TD, KVP, NSC, SCSS, MIS, SSA, PPF, a plan not in the
 * catalogue, or none yet) has no sum insured and the premium may be left blank (owner, 11 Nov 2026).
 */
export const isPostOfficeCategory = (category: string) => category.trim().toLowerCase() === "post office";
/** A post office row is insurance only for PLI: a catalogue plan of type Insurance, or a typed "Postal Life Insurance" / "PLI". */
export const isPostOfficeInsurance = (planType: ProductType | null | undefined, productName: string) =>
  planType ? planType === "Insurance" : /postal\s+life|\bpli\b/i.test(productName);
/** Every post office scheme as a catalogue product type (Po*): amount may be blank, no cover (proposals and "Add product directly"). */
export const isPostalInvestmentType = (t: ProductType | null | undefined) => !!t && t.startsWith("Po");
/**
 * What the money box / column is called (owner, 11 Nov 2026): "Amount" for every post office scheme except PLI,
 * "Investment amount" for mutual funds, "Premium" for insurance (PLI included).
 */
export type AmountKind = "premium" | "investment" | "amount";
export const AMOUNT_WORD: Record<AmountKind, string> = { premium: "Premium", investment: "Investment amount", amount: "Amount" };
export const amountKindOfType = (t: ProductType | null | undefined): AmountKind => (t === "MutualFund" ? "investment" : isPostalInvestmentType(t) ? "amount" : "premium");
/** A saved quotation row: a "Post office" row without cover is a scheme (PLI keeps its cover). */
export const amountKindOfQuoteRow = (i: { category: string; sumInsured: unknown }): AmountKind =>
  isMfCategory(i.category) ? "investment" : isPostOfficeCategory(i.category) && i.sumInsured == null ? "amount" : "premium";
/** Column header over rows of several kinds: the one word when they agree, else "Premium / amount". */
export const amountHeader = (kinds: AmountKind[]) => { const k = [...new Set(kinds)]; return k.length === 1 ? AMOUNT_WORD[k[0]] : "Premium / amount"; };
/** RD (monthly), SSA and PPF (yearly) bills are made from the amount, so it is needed once the policy number is entered. */
export const BILLED_FROM_AMOUNT: Partial<Record<ProductType, string>> = { PoRd: "the monthly RD instalment", PoSsa: "the yearly SSA deposit", PoPpf: "the yearly PPF deposit" };
/** A quoted row with no cover to show: a mutual fund, or a post office investment (no cover was saved for it). */
export const rowHasNoCover = (i: { category: string; sumInsured: unknown }) => isMfCategory(i.category) || (isPostOfficeCategory(i.category) && i.sumInsured == null);
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
