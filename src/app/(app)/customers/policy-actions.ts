"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { audit } from "@/lib/audit";
import { fmtDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { canWorkOn } from "@/lib/leads";
import { authorize } from "@/lib/session";

// Deactivate / switch back on / delete a customer's product (owner change list, #25).
// Deactivate (Admin, Super Admin): bills and reminders stop, every record stays. Delete (Super Admin): only for a
// product entered by mistake, while nothing money-related points at it. Both are logged.

const fail = (error: string): ActionResult => ({ ok: false, error });
const label = (p: { partner: string; productName: string; policyNumber: string }) => `${p.partner} ${p.productName} ${p.policyNumber}`;
const refresh = (customerId: string) => {
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/renewals");
};

async function findPolicy(tenantId: string, policyId: string) {
  return db.policy.findFirst({ where: { id: policyId, tenantId }, include: { customer: { select: { id: true, name: true } } } });
}

/** Switch a product off: unpaid bills stop (kept as Stopped) and no reminders go out. Paid history stays. */
export async function deactivatePolicy(policyId: string, reason: string): Promise<ActionResult> {
  const user = await authorize("Policy.Deactivate");
  const why = reason.trim();
  if (why.length < 3) return fail("Enter why it is being deactivated");
  const policy = await findPolicy(user.tenantId, policyId);
  if (!policy) return fail("This product no longer exists");
  if (!canWorkOn(user, policy.ownerId)) return fail("This product belongs to another user's customer");
  if (policy.status !== "Active") return fail("Only an active product can be deactivated");
  const today = istToday();
  await db.$transaction(async (tx) => {
    const updated = await tx.policy.updateMany({ where: { id: policy.id, status: "Active" }, data: { status: "Deactivated", closedOn: today, closeReason: why } });
    if (updated.count !== 1) throw new Error("The product changed while saving; reload and try again");
    const stopped = await tx.renewalItem.updateMany({ where: { policyId: policy.id, status: { in: ["Due", "Overdue"] } }, data: { status: "Stopped" } });
    await audit(tx, user, {
      entity: "Policy", entityId: policy.id, action: "Deactivated",
      summary: `${policy.customer.name} · ${label(policy)} deactivated${stopped.count ? ` · ${stopped.count} unpaid bill(s) stopped` : ""}`,
      before: { status: "Active" }, after: { status: "Deactivated", date: fmtDate(today) }, reason: why,
    });
  });
  refresh(policy.customer.id);
  return { ok: true };
}

/** Switch a deactivated product back on: its stopped bills are due again (overdue if the date has passed). */
export async function reactivatePolicy(policyId: string): Promise<ActionResult> {
  const user = await authorize("Policy.Deactivate");
  const policy = await findPolicy(user.tenantId, policyId);
  if (!policy) return fail("This product no longer exists");
  if (!canWorkOn(user, policy.ownerId)) return fail("This product belongs to another user's customer");
  if (policy.status !== "Deactivated") return fail("Only a deactivated product can be switched back on");
  const today = istToday();
  await db.$transaction(async (tx) => {
    const updated = await tx.policy.updateMany({ where: { id: policy.id, status: "Deactivated" }, data: { status: "Active", closedOn: null, closeReason: null } });
    if (updated.count !== 1) throw new Error("The product changed while saving; reload and try again");
    // A deactivated product was Active before, so every Stopped bill on it was stopped by the deactivation.
    const overdue = await tx.renewalItem.updateMany({ where: { policyId: policy.id, status: "Stopped", dueDate: { lt: today } }, data: { status: "Overdue" } });
    const due = await tx.renewalItem.updateMany({ where: { policyId: policy.id, status: "Stopped" }, data: { status: "Due" } });
    await audit(tx, user, {
      entity: "Policy", entityId: policy.id, action: "Reactivated",
      summary: `${policy.customer.name} · ${label(policy)} switched back on${overdue.count + due.count ? ` · ${overdue.count + due.count} bill(s) due again` : ""}`,
      before: { status: "Deactivated", reason: policy.closeReason }, after: { status: "Active" },
    });
  });
  refresh(policy.customer.id);
  return { ok: true };
}

/** Why a product can't be deleted (money records or a proposal point at it), or null when it can. */
async function deleteBlocker(policyId: string, proposalId: string | null) {
  const [receipts, slips, commissions, proposal] = await Promise.all([
    db.receipt.count({ where: { policyId } }),
    db.ownerPaidSlip.count({ where: { policyId } }),
    db.commission.count({ where: { policyId } }),
    proposalId ? db.proposal.findUnique({ where: { id: proposalId }, select: { proposalNo: true } }) : null,
  ]);
  if (receipts) return `It has ${receipts} receipt(s)`;
  if (slips) return `It has ${slips} owner-paid slip(s)`;
  if (commissions) return "It has commission records";
  if (proposal) return `It was issued from proposal ${proposal.proposalNo}`;
  return null;
}

/**
 * Delete a product entered by mistake (Super Admin). Refused once any receipt, owner-paid slip or commission
 * points at it, or when it was issued from a proposal – deactivate it instead. Its unpaid bills, open follow-ups
 * and bill-group place go with it; the change log keeps what it was.
 */
export async function deletePolicy(policyId: string, confirmText: string): Promise<ActionResult> {
  const user = await authorize("Policy.Delete");
  if (confirmText.trim().toUpperCase() !== "DELETE") return fail("Type DELETE to confirm");
  const policy = await findPolicy(user.tenantId, policyId);
  if (!policy) return fail("This product no longer exists");
  const blocker = await deleteBlocker(policy.id, policy.proposalId);
  if (blocker) return fail(`${blocker}, so it can't be deleted – deactivate it instead`);
  await db.$transaction(async (tx) => {
    const bills = await tx.renewalItem.deleteMany({ where: { policyId: policy.id } });
    const calls = await tx.call.deleteMany({ where: { policyId: policy.id } });
    await tx.billGroupMember.deleteMany({ where: { policyId: policy.id } });
    await tx.policy.delete({ where: { id: policy.id } });
    await audit(tx, user, {
      entity: "Policy", entityId: policy.id, action: "Deleted",
      summary: `${policy.customer.name} · ${label(policy)} deleted · ${bills.count} bill(s), ${calls.count} follow-up(s) removed`,
      before: { product: `${policy.partner} ${policy.productName}`, number: policy.policyNumber, status: policy.status, amount: policy.premiumAmount.toFixed(2), started: fmtDate(policy.startDate) },
    });
  });
  refresh(policy.customer.id);
  return { ok: true };
}
