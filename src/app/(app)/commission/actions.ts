"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { accountLabel } from "@/lib/accounts";
import { audit } from "@/lib/audit";
import { monthName } from "@/lib/commission-received";
import { fmtDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { D, fmtINR } from "@/lib/money";
import { monthKey } from "@/lib/pnl";
import { authorize } from "@/lib/session";

const fail = (error: string, field?: string): ActionResult => ({ ok: false, error, ...(field && { fieldErrors: { [field]: error } }) });

const schema = z.object({
  source: z.string().trim().min(1, "Pick the source"),
  otherSource: z.string().trim().max(60).default(""),
  forMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick the month it is for"),
  amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter the amount").refine((v) => Number(v) > 0, "Amount must be more than 0"),
  accountId: z.string().min(1, "Pick the bank account it came into"),
  reference: z.string().trim().min(2, "Enter the UTR / transaction no.").max(60),
  receivedOn: z.iso.date("Pick the date received"),
  note: z.string().trim().max(200).default(""),
});

/** Super Admin only: record commission received (an owner-only ledger, not the Day Book). */
export async function recordCommission(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Commission.View");
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return fail(i.message, String(i.path[0]));
  }
  const v = parsed.data;
  const source = v.source === "Other" ? v.otherSource.replace(/\s+/g, " ") : v.source;
  if (source.length < 2) return fail("Type the source", "otherSource");
  const today = istToday();
  const receivedOn = new Date(`${v.receivedOn}T00:00:00Z`);
  if (receivedOn > today) return fail("Date received can't be in the future", "receivedOn");
  if (v.forMonth > monthKey(today)) return fail("The month can't be in the future", "forMonth");

  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const account = await tx.account.findFirst({ where: { id: v.accountId, tenantId: user.tenantId, type: "Bank", active: true } });
    if (!account) return fail("Pick the bank account it came into", "accountId");
    const r = await tx.commissionReceipt.create({
      data: {
        tenantId: user.tenantId, source, forMonth: v.forMonth, amount: new D(v.amount), accountId: account.id, reference: v.reference,
        receivedOn, note: v.note || null, createdById: user.id,
      },
    });
    await audit(tx, user, {
      entity: "CommissionReceipt", entityId: r.id, action: "Create",
      summary: `Commission ${fmtINR(r.amount)} from ${source} for ${monthName(v.forMonth)} · into ${accountLabel(account)} on ${fmtDate(receivedOn)} · ${v.reference}`,
    });
    return { ok: true, id: r.id };
  });
  if (result.ok) revalidatePath("/commission");
  return result;
}

const cancelSchema = z.object({ id: z.string().min(1), reason: z.string().trim().min(3, "Enter why it is cancelled").max(200) });

/** Super Admin only: a wrong entry is cancelled with a reason (kept, marked Cancelled, out of the totals). */
export async function cancelCommission(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Commission.View");
  const parsed = cancelSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message, "reason");
  const { id, reason } = parsed.data;
  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const done = await tx.commissionReceipt.updateMany({
      where: { id, tenantId: user.tenantId, status: "Saved" },
      data: { status: "Cancelled", cancelReason: reason, cancelledById: user.id, cancelledAt: new Date() },
    });
    if (done.count !== 1) return fail("Not found or already cancelled");
    const r = await tx.commissionReceipt.findUniqueOrThrow({ where: { id } });
    await audit(tx, user, { entity: "CommissionReceipt", entityId: id, action: "Cancelled", summary: `Commission ${fmtINR(r.amount)} from ${r.source} for ${monthName(r.forMonth)} cancelled`, reason });
    return { ok: true };
  });
  if (result.ok) revalidatePath("/commission");
  return result;
}
