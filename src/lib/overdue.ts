const unit = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * How long something is overdue: up to 30 days in days; beyond that months (of 30 days) and the days left over
 * (31 → "1 month 1 day", 35 → "1 month 5 days", 60 → "2 months", 65 → "2 months 5 days").
 */
export function overdueText(days: number) {
  const d = Math.max(0, Math.floor(days));
  if (d <= 30) return unit(d, "day", "days");
  const m = Math.floor(d / 30), rest = d % 30;
  return rest ? `${unit(m, "month", "months")} ${unit(rest, "day", "days")}` : unit(m, "month", "months");
}

/** Whole days from `from` to `to` (both IST dates at midnight UTC). */
export const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 86_400_000);
