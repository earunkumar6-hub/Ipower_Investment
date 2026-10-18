import { addDays, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn } from "@/lib/leads";
import { refreshOverdue } from "@/lib/renewals";
import type { SessionUser } from "@/lib/session";

export const HOLDING_KIND = { Insurance: "Insurance", MutualFund: "Mutual fund", PoRd: "Post office RD", PoTd: "Post office TD", PoKvp: "KVP", PoNsc: "NSC" } as const;

/** Customer 360 data for the screen and its exports; null when missing or not this user's customer. */
export async function loadCustomer360(user: SessionUser, id: string) {
  const today = istToday();
  await refreshOverdue(user.tenantId, today);
  const c = await db.customer.findFirst({
    where: { id, tenantId: user.tenantId },
    include: {
      policies: { orderBy: [{ productType: "asc" }, { startDate: "asc" }], include: { renewals: { orderBy: { dueDate: "asc" } } } },
      receipts: { orderBy: [{ receiptDate: "desc" }, { createdAt: "desc" }], include: { policy: { select: { policyNumber: true } } } },
      ownerPaidSlips: { orderBy: { createdAt: "desc" }, include: { policy: { select: { policyNumber: true } }, closedByReceipt: { select: { receiptNo: true } } } },
    },
  });
  if (!c || !canActOn(user, c.ownerId)) return null;

  const owner = await db.user.findUnique({ where: { id: c.ownerId }, select: { name: true } });
  // Renewals: everything unpaid, plus what was paid in the last 12 months.
  const renewals = c.policies
    .flatMap((p) => p.renewals.map((r) => ({ ...r, policy: p })))
    .filter((r) => r.status !== "Paid" || (r.paidOn && r.paidOn >= addDays(today, -90)))
    .filter((r) => r.status !== "Due" || r.dueDate < addDays(today, 90))
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const active = c.policies.filter((p) => p.status === "Active");
  return {
    c,
    owner,
    renewals,
    active,
    receiptNo: new Map(c.receipts.map((r) => [r.id, r.receiptNo])),
    yearlyPremium: active.filter((p) => p.productType === "Insurance").map((p) => p.premiumAmount),
    unpaid: renewals.filter((r) => r.status === "Overdue" || (r.status === "Due" && r.dueDate <= addDays(today, 30))),
    slipFor: new Map(c.ownerPaidSlips.filter((s) => s.renewalItemId).map((s) => [s.renewalItemId!, s.slipNo])),
  };
}
