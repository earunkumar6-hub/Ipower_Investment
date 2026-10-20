import type { Frequency, InvoiceRule, Prisma, ProductType, RenewalStatus } from "@prisma/client";
import { addMonths } from "@/lib/dates";
import type { Tx } from "@/lib/db";
import { STEP_MONTHS } from "@/lib/dues";
import { renewalDueDates } from "@/lib/renewals";

// Renewal schedule rules (Oct 2026 spec, rule #13 / #24): the first payment is taken at the start; renewals are
// the payments after it, per pay mode, and stop according to the product's bill rule:
//   UntilMaturity    RD – last bill the cycle before maturity (start + term)
//   UntilPremiumTerm LIC, PLI, SBI Life, SSA, PPF – until the premium paying term ends (else the term)
//   UntilClosed      health – renews until withdrawn / closed; no maturity
//   None             TD, KVP, NSC, SCSS, MIS – one-time, no bills (mutual fund SIPs stay payable, open-ended)
// Without a catalogue product the term decides (UntilMaturity).

type SchedulePolicy = { startDate: Date; frequency: Frequency; termMonths: number | null; premiumPayingTermMonths?: number | null; productType: ProductType };

/** Bills fall due strictly before this date; null = open-ended. */
export function billEnd(p: SchedulePolicy, rule?: InvoiceRule | null): Date | null {
  if (rule === "UntilClosed") return null;
  if (rule === "None") return p.productType === "MutualFund" ? null : p.startDate;
  const months = rule === "UntilPremiumTerm" ? p.premiumPayingTermMonths ?? p.termMonths : p.termMonths;
  return months ? addMonths(p.startDate, months) : null;
}

/** Maturity (or expiry) date; health policies renew until closed and have none. */
export function maturityOf(p: SchedulePolicy, rule?: InvoiceRule | null): Date | null {
  if (rule === "UntilClosed" || !p.termMonths) return null;
  return addMonths(p.startDate, p.termMonths);
}

export type ScheduleRow = {
  n: number | null; date: Date; type: "First payment (at start)" | "Renewal" | "Maturity" | "Expiry"; amount: Prisma.Decimal | null;
  status: RenewalStatus | "Upcoming" | "Paid at start" | "Not recorded" | "—";
};

const monthEndOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
const isMonthEnd = (d: Date) => monthEndOf(d).getTime() === d.getTime();

/**
 * Every payment of a policy from start to maturity: the first payment, each renewal, then maturity / expiry.
 * Stored instalments keep their status and set the series (RD month ends, like the receipts screen); earlier
 * dates with no record are "Not recorded" (paid before this system), later ones "Upcoming". Open-ended policies
 * show the next 12 months.
 */
export function fullSchedule(p: SchedulePolicy & { premiumAmount: Prisma.Decimal }, rule: InvoiceRule | null | undefined, stored: { dueDate: Date; status: RenewalStatus; premiumAmount: Prisma.Decimal }[], today: Date): ScheduleRow[] {
  const rows: ScheduleRow[] = [{ n: null, date: p.startDate, type: "First payment (at start)", amount: p.premiumAmount, status: "Paid at start" }];
  const step = STEP_MONTHS[p.frequency];
  const end = billEnd(p, rule);
  const horizon = addMonths(today, 12);
  const sorted = [...stored].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const billed = step && (rule !== "None" || p.productType === "MutualFund");
  if (billed) {
    const monthEndSeries = sorted.length > 0 && sorted.every((s) => isMonthEnd(s.dueDate));
    const at = (k: number) => (monthEndSeries ? monthEndOf(addMonths(p.startDate, k * step)) : addMonths(p.startDate, k * step));
    const inside = (d: Date) => (end ? d < end : d <= horizon);
    // Before the first stored instalment: the policy's own series from the start.
    const first = sorted[0]?.dueDate;
    for (let k = 1; k < 1200; k++) {
      const d = at(k);
      if ((first && d >= first) || !inside(d)) break;
      rows.push({ n: null, date: d, type: "Renewal", amount: p.premiumAmount, status: d < today ? "Not recorded" : "Upcoming" });
    }
    for (const s of sorted) rows.push({ n: null, date: s.dueDate, type: "Renewal", amount: s.premiumAmount, status: s.status });
    // After the last stored instalment: continue its series until bills stop.
    const last = sorted.at(-1)?.dueDate;
    if (last) {
      for (let k = 1; k < 1200; k++) {
        const d = monthEndSeries ? monthEndOf(addMonths(last, k * step)) : addMonths(last, k * step);
        if (!inside(d)) break;
        rows.push({ n: null, date: d, type: "Renewal", amount: p.premiumAmount, status: "Upcoming" });
      }
    }
  }
  const maturity = maturityOf(p, rule);
  if (maturity) rows.push({ n: null, date: maturity, type: p.frequency === "OneTime" || rule === "None" ? "Maturity" : "Expiry", amount: null, status: "—" });
  let n = 0;
  return rows.sort((a, b) => a.date.getTime() - b.date.getTime()).map((r) => ({ ...r, n: r.type === "Maturity" || r.type === "Expiry" ? null : ++n }));
}

// One place that turns policy details into a Policy and its renewal schedule: used when a proposal's policy
// number is entered and by "Add product directly". Renewals are stored for the next 12 months (dues.ts
// continues the series for advance payments).

export type PolicyInput = {
  tenantId: string; customerId: string; ownerId: string; proposalId?: string; policyNumber: string;
  productType: ProductType; partner: string; productName: string; productId?: string | null; schemeId?: string | null;
  premiumAmount: Prisma.Decimal.Value; frequency: Frequency; startDate: Date; termMonths?: number | null; sumAssured?: Prisma.Decimal.Value | null;
  premiumPayingTermMonths?: number | null; nominee?: string | null; rateAtOpen?: Prisma.Decimal.Value | null;
  customValues?: Prisma.InputJsonValue | null; bankDetailsEnc?: string | null;
  /** From Settings → Products and schemes; without it the term decides. */
  invoiceRule?: InvoiceRule | null;
};

export async function createPolicyWithSchedule(tx: Tx, p: PolicyInput) {
  const { invoiceRule, customValues, ...data } = p;
  const policy = await tx.policy.create({ data: { ...data, ...(customValues && { customValues }) } });
  // Mutual fund SIPs are paid as they come (no stored bills); other products store the next 12 months.
  const end = p.productType === "MutualFund" ? p.startDate : billEnd({ ...p, termMonths: p.termMonths ?? null }, invoiceRule);
  const dues = renewalDueDates(p.startDate, p.frequency).filter((d) => !end || d < end);
  if (dues.length) {
    await tx.renewalItem.createMany({ data: dues.map((dueDate) => ({ tenantId: p.tenantId, policyId: policy.id, dueDate, premiumAmount: p.premiumAmount })) });
  }
  return policy;
}
