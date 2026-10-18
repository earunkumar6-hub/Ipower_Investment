"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { fmtDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { authorize } from "@/lib/session";

/** "Send now" (mocked): writes the WhatsApp reminder to the message log. */
export async function sendRenewalReminder(renewalItemId: string): Promise<ActionResult> {
  const user = await authorize("Renewal.View");
  const item = await db.renewalItem.findFirst({
    where: { id: renewalItemId, tenantId: user.tenantId, status: { in: ["Due", "Overdue"] } },
    include: { policy: { include: { customer: true } } },
  });
  if (!item) return { ok: false, error: "This renewal is no longer due" };
  if (!canActOn(user, item.policy.ownerId)) return { ok: false, error: "This policy belongs to another user" };
  const { policy } = item;
  const what = policy.productType === "PoRd" ? `RD ${policy.policyNumber} instalment` : `${policy.partner} ${policy.productName} (${policy.policyNumber}) renewal`;
  await db.$transaction([
    db.messageLog.create({
      data: {
        tenantId: user.tenantId, channel: "WhatsApp", to: policy.customer.mobile, template: "renewal_reminder",
        body: `Dear ${policy.customer.name}, your ${what} of ${fmtINR(item.premiumAmount)} ${item.status === "Overdue" ? "was due" : "is due"} on ${fmtDate(item.dueDate)}. Pay at our office by cash or UPI. – IPower Investments - R. Murali`,
        relatedType: "RenewalItem", relatedId: item.id, createdById: user.id,
      },
    }),
    db.renewalItem.update({ where: { id: item.id }, data: { lastReminderAt: new Date() } }),
  ]);
  revalidatePath("/renewals");
  return { ok: true };
}
