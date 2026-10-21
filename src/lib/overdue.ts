/** How long something is overdue: up to 30 days in days, beyond that in whole months (31 → "1 month", 65 → "2 months"). */
export function overdueText(days: number) {
  const d = Math.max(0, Math.floor(days));
  if (d <= 30) return `${d} ${d === 1 ? "day" : "days"}`;
  const m = Math.floor(d / 30);
  return `${m} ${m === 1 ? "month" : "months"}`;
}

/** Whole days from `from` to `to` (both IST dates at midnight UTC). */
export const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 86_400_000);
