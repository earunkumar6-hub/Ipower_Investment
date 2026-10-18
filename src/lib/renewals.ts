import type { Frequency } from "@prisma/client";
import { addMonths } from "@/lib/dates";
import { db } from "@/lib/db";

const STEP_MONTHS: Record<Frequency, number | null> = { Monthly: 1, Quarterly: 3, HalfYearly: 6, Yearly: 12, OneTime: null };

/**
 * Due dates after the start (first premium is paid at issue), up to `horizonMonths`
 * ahead and within the term. Yearly → 1 date, Monthly → 12.
 */
export function renewalDueDates(start: Date, frequency: Frequency, termMonths?: number | null, horizonMonths = 12): Date[] {
  const step = STEP_MONTHS[frequency];
  if (!step) return [];
  const limit = Math.min(horizonMonths, termMonths ?? Infinity);
  const dates: Date[] = [];
  for (let m = step; m <= limit; m += step) dates.push(addMonths(start, m));
  return dates;
}

/** Unpaid instalments whose due date has passed become Overdue (run before reading renewals). */
export async function refreshOverdue(tenantId: string, today: Date) {
  await db.renewalItem.updateMany({ where: { tenantId, status: "Due", dueDate: { lt: today } }, data: { status: "Overdue" } });
}
