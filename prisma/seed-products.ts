// Settings → Products and schemes: the sample catalogue from the owner's screen (Oct 2026), plus the
// insurers and AMCs the demo policies use. Rates are dummy values – check before going live.
import type { CustomFieldType, Frequency, InvoiceRule, ProductType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { defaultQuoteGroup } from "@/lib/products";

type SchemeSeed = { name: string; tenure: number | null; rates?: [string, string, "admin" | "owner"][] };
type ProductSeed = {
  name: string; productType: ProductType; partner: string; invoiceRule: InvoiceRule; payModes: Frequency[]; lockIn?: number;
  bank?: boolean; premature?: boolean; fields?: string[]; required?: string[]; schemes: SchemeSeed[];
  custom?: { label: string; type: CustomFieldType; options?: string[]; required?: boolean }[];
};

const PO_FIELDS = ["policyNumber", "commencement", "maturity", "nominee"];
const INS_FIELDS = ["policyNumber", "commencement", "maturity", "premiumPayingTerm", "nominee"];
const BANK = ["holder", "bank", "branch", "ifsc", "accountNo"];
const BRANCH = { label: "Post office branch", type: "Dropdown" as const, options: ["Chennai GPO", "Mylapore", "T. Nagar", "Adyar"], required: true };

const rate = (r: string, from: string, by: "admin" | "owner" = "admin"): [string, string, "admin" | "owner"] => [r, from, by];

const CATALOGUE: ProductSeed[] = [
  { name: "Post Office RD", productType: "PoRd", partner: "Post Office", invoiceRule: "UntilMaturity", payModes: ["Monthly"], lockIn: 36, fields: PO_FIELDS, required: ["policyNumber", "commencement"],
    schemes: [{ name: "RD 5 years", tenure: 60, rates: [rate("6.70", "2026-10-01")] }], custom: [BRANCH] },
  { name: "Post Office TD", productType: "PoTd", partner: "Post Office", invoiceRule: "None", payModes: ["OneTime"], lockIn: 6, bank: true, fields: PO_FIELDS, required: ["policyNumber", "commencement"],
    schemes: [
      { name: "TD 1 year", tenure: 12, rates: [rate("6.90", "2026-10-01")] },
      { name: "TD 2 years", tenure: 24, rates: [rate("7.00", "2026-10-01")] },
      { name: "TD 3 years", tenure: 36, rates: [rate("7.10", "2026-10-01")] },
      { name: "TD 5 years", tenure: 60, rates: [rate("7.50", "2025-10-01"), rate("7.40", "2026-04-01", "owner"), rate("7.50", "2026-10-01")] },
    ],
    custom: [BRANCH, { label: "Interest payout", type: "Dropdown", options: ["Yearly", "To bank"] }] },
  { name: "KVP", productType: "PoKvp", partner: "Post Office", invoiceRule: "None", payModes: ["OneTime"], lockIn: 30, fields: PO_FIELDS, required: ["policyNumber", "commencement"],
    schemes: [{ name: "KVP", tenure: 115, rates: [rate("7.50", "2026-10-01")] }] },
  { name: "NSC", productType: "PoNsc", partner: "Post Office", invoiceRule: "None", payModes: ["OneTime"], lockIn: 60, premature: false, fields: PO_FIELDS, required: ["policyNumber", "commencement"],
    schemes: [{ name: "NSC VIII issue", tenure: 60, rates: [rate("6.70", "2026-10-01")] }] },
  { name: "SCSS", productType: "PoScss", partner: "Post Office", invoiceRule: "None", payModes: ["OneTime"], lockIn: 12, bank: true, fields: PO_FIELDS, required: ["policyNumber", "commencement"],
    schemes: [{ name: "SCSS", tenure: 60, rates: [rate("8.20", "2026-10-01")] }] },
  { name: "Post Office MIS", productType: "PoMis", partner: "Post Office", invoiceRule: "None", payModes: ["OneTime"], lockIn: 12, bank: true, fields: PO_FIELDS, required: ["policyNumber", "commencement"],
    schemes: [{ name: "MIS 5 years", tenure: 60, rates: [rate("7.40", "2026-10-01")] }] },
  { name: "SSA", productType: "PoSsa", partner: "Post Office", invoiceRule: "UntilPremiumTerm", payModes: ["Yearly"], lockIn: 60, fields: [...PO_FIELDS, "premiumPayingTerm"], required: ["policyNumber", "commencement"],
    schemes: [{ name: "SSA", tenure: 252, rates: [rate("8.20", "2026-10-01")] }] },
  { name: "PPF", productType: "PoPpf", partner: "Post Office", invoiceRule: "UntilPremiumTerm", payModes: ["Yearly"], lockIn: 60, fields: [...PO_FIELDS, "premiumPayingTerm"], required: ["policyNumber", "commencement"],
    schemes: [{ name: "PPF 15 years", tenure: 180, rates: [rate("7.10", "2026-10-01")] }] },
  { name: "Jeevan Anand", productType: "Insurance", partner: "LIC", invoiceRule: "UntilPremiumTerm", payModes: ["Yearly", "HalfYearly", "Quarterly", "Monthly"], lockIn: 36, bank: true, fields: INS_FIELDS, required: ["policyNumber", "commencement", "premiumPayingTerm"],
    schemes: [{ name: "Plan 20 years", tenure: 240 }, { name: "Plan 25 years", tenure: 300 }] },
  // Postal Life Insurance: life insurance sold by the post office (all four pay modes; term per policy).
  { name: "Postal Life Insurance", productType: "Insurance", partner: "Post Office", invoiceRule: "UntilPremiumTerm", payModes: ["Yearly", "HalfYearly", "Quarterly", "Monthly"], lockIn: 36, bank: true, fields: INS_FIELDS, required: ["policyNumber", "commencement", "premiumPayingTerm"],
    schemes: ["Santosh (Endowment)", "Suraksha (Whole life)", "Suvidha (Convertible whole life)", "Sumangal (Money back)", "Yugal Suraksha (Joint life)", "Bal Jeevan Bima (Children)"].map((name) => ({ name, tenure: null })) },
  { name: "Smart Shield", productType: "Insurance", partner: "SBI Life", invoiceRule: "UntilPremiumTerm", payModes: ["Yearly", "Monthly"], bank: true, fields: INS_FIELDS, required: ["policyNumber", "commencement", "premiumPayingTerm"],
    schemes: [{ name: "Term 30 years", tenure: 360 }] },
  { name: "eShield Next", productType: "Insurance", partner: "SBI Life", invoiceRule: "UntilPremiumTerm", payModes: ["Yearly"], bank: true, fields: INS_FIELDS, required: ["policyNumber", "commencement"],
    schemes: [{ name: "Term 25 years", tenure: 300 }] },
  { name: "eWealth", productType: "Insurance", partner: "SBI Life", invoiceRule: "UntilPremiumTerm", payModes: ["Yearly"], lockIn: 60, bank: true, fields: INS_FIELDS, required: ["policyNumber", "commencement"],
    schemes: [{ name: "Savings 10 years", tenure: 120, rates: [rate("6.00", "2026-04-01")] }, { name: "Savings 15 years", tenure: 180, rates: [rate("6.00", "2026-04-01")] }] },
  ...([["Star Health", "Family Health Optima"], ["Star Health", "Comprehensive"], ["Star Health", "Senior Citizens Red Carpet"], ["Care Health", "Care Supreme"], ["SBI General", "Health Insurance"]] as const)
    .map(([partner, name]): ProductSeed => ({
      name, productType: "Insurance", partner, invoiceRule: "UntilClosed", payModes: ["Yearly"], fields: ["policyNumber", "commencement", "nominee"], required: ["policyNumber", "commencement"],
      schemes: [{ name: "Individual", tenure: 12 }, { name: "Family", tenure: 12 }],
    })),
  ...([["HDFC MF", "Flexi Cap SIP"], ["SBI MF", "Bluechip SIP"], ["Axis MF", "ELSS SIP"], ["HDFC MF", "Bluechip SIP"], ["HDFC MF", "ELSS SIP"], ["SBI MF", "Flexi Cap SIP"], ["SBI MF", "ELSS SIP"], ["Axis MF", "Flexi Cap SIP"], ["Axis MF", "Bluechip SIP"]] as const)
    .map(([partner, name]): ProductSeed => ({
      name, productType: "MutualFund", partner, invoiceRule: "None", payModes: ["Monthly", "OneTime"], lockIn: name.startsWith("ELSS") ? 36 : undefined, premature: false,
      fields: ["policyNumber", "commencement", "nominee"], required: ["policyNumber"], schemes: [{ name: "Direct growth", tenure: null }],
    })),
];

export async function seedProducts(tenantId: string, users: { admin: string; owner: string }) {
  for (const p of CATALOGUE) {
    const product = await prisma.product.create({
      data: {
        tenantId, name: p.name, productType: p.productType, partner: p.partner, category: defaultQuoteGroup(p), invoiceRule: p.invoiceRule, payModes: p.payModes, lockInMonths: p.lockIn ?? null,
        bankDetailsRequired: !!p.bank, bankFields: p.bank ? BANK : [], prematureClosure: p.productType === "MutualFund" ? false : p.premature ?? true,
        fields: p.fields ?? PO_FIELDS, requiredFields: p.required ?? ["policyNumber"],
      },
    });
    for (const s of p.schemes) {
      await prisma.scheme.create({
        data: {
          productId: product.id, name: s.name, tenureMonths: s.tenure,
          rates: { create: (s.rates ?? []).map(([r, from, by]) => ({ rate: r, effectiveFrom: new Date(`${from}T00:00:00Z`), changedById: users[by] })) },
        },
      });
    }
    for (const [i, f] of (p.custom ?? []).entries()) {
      await prisma.productCustomField.create({ data: { productId: product.id, label: f.label, type: f.type, options: f.options ?? [], required: !!f.required, sort: i } });
    }
  }
}

/**
 * Links the demo policies to the catalogue: post office by scheme type (scheme by term), insurance and
 * mutual funds by partner + product name (scheme by term when it matches, else the first one).
 */
export async function linkPolicies(tenantId: string) {
  const products = await prisma.product.findMany({ where: { tenantId }, include: { schemes: true } });
  const policies = await prisma.policy.findMany({ where: { tenantId } });
  for (const pol of policies) {
    const product = pol.productType === "Insurance" || pol.productType === "MutualFund"
      ? products.find((p) => p.partner === pol.partner && p.name === pol.productName)
      : products.find((p) => p.productType === pol.productType);
    if (!product) continue;
    const scheme = product.schemes.find((s) => s.tenureMonths !== null && s.tenureMonths === pol.termMonths) ?? product.schemes[0];
    await prisma.policy.update({ where: { id: pol.id }, data: { productId: product.id, schemeId: scheme?.id } });
  }
}
