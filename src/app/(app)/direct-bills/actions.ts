"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { cashAndBank, receivingAccountId } from "@/lib/accounts";
import { refuseOnClosedDay } from "@/lib/action-guard";
import { audit } from "@/lib/audit";
import { reverseSource } from "@/lib/daybook";
import { fmtDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { D, fmtINR } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import { checkPayment, MODE_LABEL, payFields } from "@/lib/payment-options";
import { postDirectBill } from "@/lib/posting";
import { authorize } from "@/lib/session";

const schema = z.object({
  payerName: z.string().trim().min(2, "Enter the payer's name").max(80),
  payerMobile: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number"),
  purpose: z.string().trim().min(2, "Enter what the money is for").max(120),
  amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount").refine((v) => Number(v) > 0, "Amount must be more than 0"),
  billDate: z.union([
    z.literal(""),
    z.iso.date("Pick a date").refine((d) => new Date(`${d}T00:00:00Z`) <= istToday(), "Date can't be in the future"),
  ]).optional(),
  ...payFields, // mode, reference, bank name (net banking), cash denomination
});

/** Bill for a customer or a walk-in (name + mobile): money in through the Day Book, linked to the customer with that mobile. */
async function createDirectBillUnguarded(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Receipt.Create");
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, fieldErrors: { [String(issue.path[0])]: issue.message } };
  }
  const v = parsed.data;
  const amount = new D(v.amount);
  const billDate = v.billDate ? new Date(`${v.billDate}T00:00:00Z`) : istToday();

  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    // Same back-dating rule as receipts: only days after the last close.
    const lastClose = await tx.dayClose.findFirst({ where: { tenantId: user.tenantId, status: "Closed" }, orderBy: { date: "desc" }, select: { date: true } });
    if (lastClose && billDate < lastClose.date) {
      const msg = `Day Book is closed up to ${fmtDate(lastClose.date)}; pick a later bill date`;
      return { ok: false, error: msg, fieldErrors: { billDate: msg } };
    }
    const pay = await checkPayment(tx, user.tenantId, v, amount);
    if ("error" in pay) return { ok: false, error: pay.error, fieldErrors: { [pay.field]: pay.error } };
    const customer = await tx.customer.findFirst({
      where: { tenantId: user.tenantId, OR: [{ mobile: v.payerMobile }, { mobiles: { some: { number: v.payerMobile } } }] },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    const accounts = await cashAndBank(tx, user.tenantId);
    const bill = await tx.directBill.create({
      data: {
        tenantId: user.tenantId, billNo: await nextNumber(tx, user.tenantId, "directBill"), billDate,
        customerId: customer?.id ?? null, payerName: v.payerName, payerMobile: v.payerMobile, purpose: v.purpose, amount,
        mode: v.mode, accountId: receivingAccountId(v.mode, accounts), reference: pay.ok.reference, bankName: pay.ok.bankName, netType: pay.ok.netType,
        denominations: pay.ok.denominations, createdById: user.id,
      },
    });
    await postDirectBill(tx, bill);
    await audit(tx, user, { entity: "DirectBill", entityId: bill.id, action: "Create", summary: `${bill.billNo} · ${v.payerName} · ${v.purpose} · ${fmtINR(amount)}` });
    await tx.messageLog.create({
      data: {
        tenantId: user.tenantId, channel: "WhatsApp", to: v.payerMobile, template: "receipt", relatedType: "DirectBill", relatedId: bill.id, createdById: user.id,
        body: `Thank you ${v.payerName}. Received ${fmtINR(amount)} (${MODE_LABEL[v.mode]}) for ${v.purpose}. Bill ${bill.billNo}.`,
      },
    });
    return { ok: true, id: bill.id, href: `/direct-bills/${bill.id}` };
  });
  if (result.ok) revalidatePath("/direct-bills");
  return result;
}

const cancelSchema = z.object({ billId: z.string().min(1), reason: z.string().trim().min(3, "Enter the reason") });

/** Admin / Super Admin: marks the bill Cancelled (number kept) and reverses its Day Book entry today. */
async function cancelDirectBillUnguarded(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Receipt.Cancel");
  const parsed = cancelSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { billId, reason } = parsed.data;
  const today = istToday();

  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const b = await tx.directBill.findFirst({ where: { id: billId, tenantId: user.tenantId } });
    if (!b) return { ok: false, error: "Bill not found" };
    if (b.status === "Cancelled") return { ok: false, error: "Already cancelled" };
    await tx.directBill.update({ where: { id: b.id }, data: { status: "Cancelled", cancelReason: reason, cancelledById: user.id, cancelledAt: new Date() } });
    await reverseSource(tx, { tenantId: user.tenantId, sourceType: "DirectBill", sourceId: b.id, entryDate: today, createdById: user.id, reason });
    await audit(tx, user, { entity: "DirectBill", entityId: b.id, action: "Cancel", summary: `${b.billNo} cancelled: ${reason}` });
    return { ok: true };
  });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function createDirectBill(_: ActionResult, form: FormData): Promise<ActionResult> {
  return refuseOnClosedDay(() => createDirectBillUnguarded(_, form));
}

export async function cancelDirectBill(_: ActionResult, form: FormData): Promise<ActionResult> {
  return refuseOnClosedDay(() => cancelDirectBillUnguarded(_, form));
}
