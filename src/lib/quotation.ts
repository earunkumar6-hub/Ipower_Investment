import { Prisma } from "@prisma/client";
import { istToday } from "@/lib/dates";
import { round2, sum } from "@/lib/money";

/** No GST on insurance / investment quotes (owner, 29 Oct 2026): the customer pays the premium. */
export function priceItem(premium: Prisma.Decimal.Value) {
  const p = round2(premium);
  return { premium: p, total: p };
}

export function priceQuotation(premiums: Prisma.Decimal.Value[]) {
  const items = premiums.map(priceItem);
  return {
    items,
    subtotal: sum(items.map((i) => i.premium)),
    total: sum(items.map((i) => i.total)),
  };
}

type Tone = "green" | "orange" | "slate" | "blue" | "red" | "purple" | "indigo";

/** Draft / Expired / Accepted / Converted (a policy issued) / Not accepted / Deleted, with its badge colour. */
export function quotationStatus(q: { status: "Draft" | "Accepted" | "NotAccepted"; validUpto: Date; deletedAt: Date | null; items: { proposal: { status: string } | null }[] }, today = istToday()): [string, Tone] {
  if (q.deletedAt) return ["Deleted", "slate"];
  if (q.items.some((i) => i.proposal?.status === "Issued")) return ["Converted", "green"];
  if (q.status === "Accepted") return ["Accepted", "blue"];
  if (q.status === "NotAccepted") return ["Not accepted", "orange"];
  return q.validUpto < today ? ["Expired", "red"] : ["Draft", "slate"];
}
