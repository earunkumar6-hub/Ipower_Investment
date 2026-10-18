"use server";

import { revalidatePath } from "next/cache";
import { refuseOnClosedDay } from "@/lib/action-guard";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { cashAndBank, receivingAccountId } from "@/lib/accounts";
import { poCommission } from "@/lib/commission";
import { reverseSource } from "@/lib/daybook";
import { financialYear, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn } from "@/lib/leads";
import { D, fmtINR, sum } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import { postOwnerReturn, postReceipt } from "@/lib/posting";
import { authorize } from "@/lib/session";

const money = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount").refine((v) => Number(v) > 0, "Amount must be more than 0");

const receiptSchema = z
  .object({
    customerId: z.string().min(1),
    policyId: z.string(),
    renewalItemId: z.string(),
    amount: money,
    mode: z.enum(["Cash", "UPI", "Cheque"]),
    reference: z.string().trim().max(40),
    notes: z.string().trim().max(200),
    slipIds: z.string(), // comma-separated owner-paid slips to close with this payment
  })
  .refine((v) => v.mode === "Cash" || v.reference, { message: "Enter the UTR or cheque number", path: ["reference"] });

async function createReceiptUnguarded(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Receipt.Create");
  const parsed = receiptSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: i.message, fieldErrors: { [String(i.path[0])]: i.message } };
  }
  const v = parsed.data;
  const amount = new D(v.amount);
  const slipIds = v.slipIds.split(",").filter(Boolean);
  const today = istToday();

  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const customer = await tx.customer.findFirst({ where: { id: v.customerId, tenantId: user.tenantId } });
    if (!customer) return { ok: false, error: "Customer not found" };
    if (!canActOn(user, customer.ownerId)) return { ok: false, error: "This customer belongs to another user" };
    const accounts = await cashAndBank(tx, user.tenantId);
    const base = {
      tenantId: user.tenantId,
      receiptNo: await nextNumber(tx, user.tenantId, "receipt"),
      fy: financialYear(today),
      receiptDate: today,
      customerId: customer.id,
      amount,
      mode: v.mode,
      accountId: receivingAccountId(v.mode, accounts),
      reference: v.reference || null,
      notes: v.notes || null,
      createdById: user.id,
    };

    let receipt;
    let policy;
    if (slipIds.length) {
      // Customer repays instalments the owner already paid at the post office.
      const slips = await tx.ownerPaidSlip.findMany({
        where: { id: { in: slipIds }, tenantId: user.tenantId, customerId: customer.id, status: "CustomerOwes" },
      });
      if (slips.length !== slipIds.length) return { ok: false, error: "Some owner-paid slips are no longer open; reload and try again" };
      const selected = sum(slips.map((s) => s.amount));
      if (!selected.equals(amount)) {
        return { ok: false, error: `Payment ${fmtINR(amount)} must equal the slips selected (${fmtINR(selected)})` };
      }
      policy = await tx.policy.findUniqueOrThrow({ where: { id: slips[0].policyId } });
      receipt = await tx.receipt.create({
        data: { ...base, policyId: policy.id, ownerPaid: true, notes: v.notes || `Owner-paid ${slips.map((s) => s.slipNo).join(", ")}` },
      });
      await tx.ownerPaidSlip.updateMany({
        where: { id: { in: slipIds }, status: "CustomerOwes" },
        data: { status: "CollectedReturnToOwner", closedByReceiptId: receipt.id },
      });
    } else {
      policy = await tx.policy.findFirst({ where: { id: v.policyId, customerId: customer.id } });
      if (!policy) return { ok: false, error: "Pick the policy or account being paid", fieldErrors: { policyId: "Required" } };
      const item = v.renewalItemId
        ? await tx.renewalItem.findFirst({ where: { id: v.renewalItemId, policyId: policy.id, status: { in: ["Due", "Overdue"] } } })
        : null;
      if (v.renewalItemId && !item) return { ok: false, error: "That instalment is already paid; reload and try again" };
      if (item && !item.premiumAmount.equals(amount)) {
        return { ok: false, error: `Amount must be ${fmtINR(item.premiumAmount)} for this instalment`, fieldErrors: { amount: "Mismatch" } };
      }
      const isRd = policy.productType === "PoRd";
      receipt = await tx.receipt.create({
        data: { ...base, policyId: policy.id, renewalItemId: item?.id, rdStatus: isRd ? "Collected" : null },
      });
      if (item) await tx.renewalItem.update({ where: { id: item.id }, data: { status: "Paid", paidOn: today, paidReceiptId: receipt.id } });
      if (isRd) {
        await tx.commission.create({
          data: { tenantId: user.tenantId, sourceType: "RdReceipt", sourceNo: receipt.receiptNo, policyId: policy.id, receiptId: receipt.id, earnedOn: today, ...poCommission("PoRd", amount) },
        });
      }
    }

    await postReceipt(tx, receipt, { customerName: customer.name, policy });
    await tx.messageLog.create({
      data: {
        tenantId: user.tenantId, channel: "WhatsApp", to: customer.mobile, template: "receipt",
        body: `Thank you ${customer.name}. Received ${fmtINR(amount)} (${v.mode}) for ${policy.partner} ${policy.policyNumber}. Receipt ${receipt.receiptNo}.`,
        relatedType: "Receipt", relatedId: receipt.id, createdById: user.id,
      },
    });
    return { ok: true, id: receipt.id };
  });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

const cancelSchema = z.object({ receiptId: z.string(), reason: z.string().trim().min(3, "Enter the reason") });

/** Admin / Super Admin only. The number is never reused; the Day Book gets a reversing entry dated today. */
async function cancelReceiptUnguarded(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Receipt.Cancel");
  const parsed = cancelSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { receiptId, reason } = parsed.data;
  const today = istToday();

  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const r = await tx.receipt.findFirst({ where: { id: receiptId, tenantId: user.tenantId } });
    if (!r) return { ok: false, error: "Receipt not found" };
    if (r.status === "Cancelled") return { ok: false, error: "Already cancelled" };
    if (r.rdStatus === "Deposited" || r.rdStatus === "Verified") {
      return { ok: false, error: "Already deposited at the post office; it can't be cancelled here" };
    }
    await tx.receipt.update({ where: { id: r.id }, data: { status: "Cancelled", cancelReason: reason, cancelledById: user.id, cancelledAt: new Date() } });
    await reverseSource(tx, { tenantId: user.tenantId, sourceType: "Receipt", sourceId: r.id, entryDate: today, createdById: user.id, reason });
    // The instalment is unpaid again.
    const item = await tx.renewalItem.findFirst({ where: { paidReceiptId: r.id } });
    if (item) {
      await tx.renewalItem.update({
        where: { id: item.id },
        data: { status: item.dueDate < today ? "Overdue" : "Due", paidOn: null, paidReceiptId: null },
      });
    }
    await tx.commission.updateMany({ where: { receiptId: r.id }, data: { status: "Cancelled" } });
    await tx.ownerPaidSlip.updateMany({ where: { closedByReceiptId: r.id }, data: { status: "CustomerOwes", closedByReceiptId: null } });
    return { ok: true };
  });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

const ownerPaidSchema = z.object({
  renewalItemId: z.string().min(1, "Pick the RD instalment"),
  poReceiptNo: z.string().trim().min(3, "Enter the post office receipt number"),
});

/** The owner paid a customer's RD instalment at the post office; no company money moves. */
export async function recordOwnerPaid(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Receipt.Create");
  const parsed = ownerPaidSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { renewalItemId, poReceiptNo } = parsed.data;
  const today = istToday();

  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const item = await tx.renewalItem.findFirst({
      where: { id: renewalItemId, tenantId: user.tenantId, status: { in: ["Due", "Overdue"] }, policy: { productType: "PoRd" } },
      include: { policy: true },
    });
    if (!item) return { ok: false, error: "That RD instalment is not open" };
    if (!canActOn(user, item.policy.ownerId)) return { ok: false, error: "This account belongs to another user" };
    const slip = await tx.ownerPaidSlip.create({
      data: {
        tenantId: user.tenantId, slipNo: await nextNumber(tx, user.tenantId, "slip"), policyId: item.policyId,
        customerId: item.policy.customerId, renewalItemId: item.id, month: item.dueDate, amount: item.premiumAmount,
        poReceiptNo, createdById: user.id,
      },
    });
    await tx.renewalItem.update({ where: { id: item.id }, data: { status: "Paid", paidOn: today } });
    await tx.commission.create({
      data: { tenantId: user.tenantId, sourceType: "RdReceipt", sourceNo: poReceiptNo, policyId: item.policyId, earnedOn: today, ...poCommission("PoRd", item.premiumAmount) },
    });
    return { ok: true, id: slip.id };
  });
  if (result.ok) revalidatePath("/receipts");
  return result;
}

const returnSchema = z.object({ slipId: z.string().min(1, "Pick a slip"), mode: z.enum(["Cash", "Bank"]) });

/** Hand the collected money back to the owner: Day Book outflow, slip settled. */
async function returnToOwnerUnguarded(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("DayBook.Create");
  const parsed = returnSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { slipId, mode } = parsed.data;
  const today = istToday();

  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const slip = await tx.ownerPaidSlip.findFirst({ where: { id: slipId, tenantId: user.tenantId, status: "CollectedReturnToOwner" } });
    if (!slip) return { ok: false, error: "Only slips the customer has paid can be returned" };
    const accounts = await cashAndBank(tx, user.tenantId);
    const [entry] = await postOwnerReturn(tx, slip, { accountId: mode === "Cash" ? accounts.cash.id : accounts.bank.id, mode, date: today, createdById: user.id });
    await tx.ownerPaidSlip.update({
      where: { id: slip.id },
      data: { status: "Settled", returnedEntryId: entry.id, confirmedById: user.id, confirmedOn: new Date() },
    });
    return { ok: true };
  });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function createReceipt(_: ActionResult, form: FormData): Promise<ActionResult> {
  return refuseOnClosedDay(() => createReceiptUnguarded(_, form));
}

export async function cancelReceipt(_: ActionResult, form: FormData): Promise<ActionResult> {
  return refuseOnClosedDay(() => cancelReceiptUnguarded(_, form));
}

export async function returnToOwner(_: ActionResult, form: FormData): Promise<ActionResult> {
  return refuseOnClosedDay(() => returnToOwnerUnguarded(_, form));
}
