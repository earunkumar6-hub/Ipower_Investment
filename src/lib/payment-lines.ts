import type { Frequency, RenewalItem } from "@prisma/client";
import { fmtDate } from "@/lib/dates";

const monthLabel = (d: Date) => d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

/** "Nov 2026" for monthly instalments, "15 Oct 2026" otherwise; "—" for a payment with no instalment. */
export function dueLabel(r: { renewalItemId: string | null; policy: { frequency: Frequency } | null }, items: Pick<RenewalItem, "id" | "dueDate">[]) {
  const item = items.find((i) => i.id === r.renewalItemId);
  if (!item) return "—";
  return r.policy?.frequency === "Monthly" ? monthLabel(item.dueDate) : fmtDate(item.dueDate);
}
