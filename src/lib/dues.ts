import type { Frequency, Prisma, RenewalStatus } from "@prisma/client";
import { addMonths } from "@/lib/dates";
import type { Tx } from "@/lib/db";

// What a customer can pay on a policy right now: unpaid instalments oldest first, then advance
// instalments up to 12 months ahead (never past the term). Advance instalments are not stored
// until they are paid.

export const ADVANCE_MONTHS = 12;
export const STEP_MONTHS: Record<Frequency, number | null> = { Monthly: 1, Quarterly: 3, HalfYearly: 6, Yearly: 12, OneTime: null };

const monthEnd = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
const isMonthEnd = (d: Date) => monthEnd(d).getTime() === d.getTime();

/** `months` after `anchor`; a month-end series stays on month ends (30 Sep → 31 Oct). */
export const seriesDate = (anchor: Date, months: number, monthEndSeries: boolean) =>
  monthEndSeries ? monthEnd(addMonths(anchor, months)) : addMonths(anchor, months);

/** `billUntil`: bills fall due strictly before it (from the product's bill rule, see billEnd in policies.ts); default start + term. */
export type DuePolicy = { startDate: Date; frequency: Frequency; termMonths: number | null; premiumAmount: Prisma.Decimal; billUntil?: Date | null };
export type StoredDue = { id: string; dueDate: Date; premiumAmount: Prisma.Decimal; status: RenewalStatus };
/** `itemId` null = advance instalment, created when paid. */
export type Due = { itemId: string | null; dueDate: Date; amount: Prisma.Decimal };

export function payableDues(policy: DuePolicy, stored: StoredDue[], today: Date): Due[] {
  const limit = addMonths(today, ADVANCE_MONTHS);
  const all = [...stored].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const open: Due[] = all
    .filter((r) => (r.status === "Due" || r.status === "Overdue") && r.dueDate <= limit)
    .map((r) => ({ itemId: r.id, dueDate: r.dueDate, amount: r.premiumAmount }));

  const step = STEP_MONTHS[policy.frequency];
  if (!step) return open;
  // Continue the policy's own series: from its first stored due (month ends for RD), else from the start date.
  const anchor = all[0]?.dueDate ?? policy.startDate;
  const monthEndSeries = all.length > 0 && all.every((r) => isMonthEnd(r.dueDate));
  const last = all.at(-1)?.dueDate;
  const end = policy.billUntil !== undefined ? policy.billUntil : policy.termMonths ? addMonths(policy.startDate, policy.termMonths) : null;
  const advance: Due[] = [];
  for (let k = 1; ; k++) {
    const d = seriesDate(anchor, k * step, monthEndSeries);
    if (d > limit || (end && d >= end)) break;
    if (last ? d > last : d >= today) advance.push({ itemId: null, dueDate: d, amount: policy.premiumAmount });
  }
  return [...open, ...advance];
}

/** Serialises everyone paying dues on this policy, so an advance month can't be created twice. */
export async function lockPolicyDues(tx: Tx, policyId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dues:${policyId}`}))`;
}
