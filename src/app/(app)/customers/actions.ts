"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { audit } from "@/lib/audit";
import { fmtDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn } from "@/lib/leads";
import { lockInUntil } from "@/lib/products";
import { authorize } from "@/lib/session";

const fail = (error: string, fieldErrors?: Record<string, string>): ActionResult => ({ ok: false, error, fieldErrors });

const closeSchema = z.object({
  policyId: z.string().min(1),
  kind: z.enum(["close", "withdraw"]),
  closedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date").transform((s) => new Date(`${s}T00:00:00Z`)),
  reason: z.string().trim().max(200).default(""),
});

/**
 * Premature closure (every product except mutual funds) or a mutual fund withdrawal. Bills and reminders
 * stop: unpaid instalments become Stopped, paid history stays. No money moves in the Day Book – the
 * partner pays the customer directly.
 */
export async function closePolicy(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Policy.Create");
  const parsed = closeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;

  const policy = await db.policy.findFirst({ where: { id: v.policyId, tenantId: user.tenantId }, include: { product: true, customer: { select: { id: true, name: true } } } });
  if (!policy) return fail("This policy no longer exists");
  if (!canActOn(user, policy.ownerId)) return fail("This policy belongs to another user's customer");
  if (policy.status !== "Active") return fail(`This policy is already ${policy.status === "PrematureClosed" ? "closed early" : policy.status.toLowerCase()}`);
  const isMf = policy.productType === "MutualFund";
  if (isMf && v.kind === "close") return fail("Mutual funds are withdrawn, not closed early – enter the withdraw date");
  if (!isMf && v.kind === "withdraw") return fail("Only mutual funds are withdrawn; use premature closure");
  if (v.kind === "close" && v.reason.length < 3) return fail("Enter the reason for closing early", { reason: "Required" });
  if (v.closedOn > istToday()) return fail("The date can't be in the future");
  if (v.closedOn < policy.startDate) return fail(`The date can't be before the start date (${fmtDate(policy.startDate)})`);
  if (v.kind === "close" && policy.product) {
    if (!policy.product.prematureClosure) return fail(`${policy.product.name} can't be closed early (Settings → Products and schemes)`);
    const lockIn = lockInUntil(policy.startDate, policy.product.lockInMonths);
    if (lockIn && v.closedOn < lockIn) return fail(`Lock-in runs until ${fmtDate(lockIn)}; it can't be closed before then`);
  }

  const status = v.kind === "close" ? "PrematureClosed" : "Withdrawn";
  const label = v.kind === "close" ? "Closed early" : "Withdrawn";
  await db.$transaction(async (tx) => {
    const updated = await tx.policy.updateMany({ where: { id: policy.id, status: "Active" }, data: { status, closedOn: v.closedOn, closeReason: v.reason || null } });
    if (updated.count !== 1) throw new Error("The policy changed while saving; reload and try again");
    const stopped = await tx.renewalItem.updateMany({ where: { policyId: policy.id, status: { in: ["Due", "Overdue"] } }, data: { status: "Stopped" } });
    await audit(tx, user, {
      entity: "Policy", entityId: policy.id, action: label,
      summary: `${policy.customer.name} · ${policy.partner} ${policy.productName} ${policy.policyNumber} ${label.toLowerCase()} on ${fmtDate(v.closedOn)}${stopped.count ? ` · ${stopped.count} unpaid instalment(s) stopped` : ""}`,
      before: { status: "Active" },
      after: { status: label, date: fmtDate(v.closedOn) },
      reason: v.reason || null,
    });
  });
  revalidatePath(`/customers/${policy.customer.id}`);
  revalidatePath("/renewals");
  return { ok: true };
}
