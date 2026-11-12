"use server";

import type { Policy, Prisma, Receipt } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { refuseOnClosedDay } from "@/lib/action-guard";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { cashAndBank } from "@/lib/accounts";
import { poCommission } from "@/lib/commission";
import { reverseSource } from "@/lib/daybook";
import { financialYear, istToday } from "@/lib/dates";
import { db, type Tx } from "@/lib/db";
import { canActOn } from "@/lib/leads";
import { seesAll } from "@/lib/permissions";
import { D, fmtINR, sum } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import { postOwnerReturn } from "@/lib/posting";
import { OWNER_PAYABLE } from "@/lib/dues";
import { canSeePayment, payerOf } from "@/lib/payment-lines";
import { addReceiptLine, closedDayError, dateOrToday, duesField, type LineCommon, moneyField, pastOrTodayField, payDueLine, pickDues, Refused } from "@/lib/receipt-lines";
import { checkDenominations, checkPayment, denominationsField, modeLabel, payFields } from "@/lib/payment-options";
import { authorize } from "@/lib/session";

const receiptSchema = z
  .object({
    customerId: z.string().min(1),
    policyId: z.string(), // "other payment" (no instalment) only
    dues: duesField,
    amount: moneyField,
    ...payFields, // mode, reference, bank name (net banking), cash denomination
    notes: z.string().trim().max(200),
    slipIds: z.string(), // comma-separated owner-paid slips to close with this payment
    receiptDate: pastOrTodayField, // bill date
    txnDate: pastOrTodayField, // when the customer actually paid
  });


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
  // The bill date drives everything dated by this receipt: Day Book, FY, paid-on, commission.
  const billDate = dateOrToday(v.receiptDate);
  const today = istToday();

  try {
    const result = await db.$transaction(async (tx): Promise<ActionResult> => {
      const customer = await tx.customer.findFirst({ where: { id: v.customerId, tenantId: user.tenantId } });
      if (!customer) return { ok: false, error: "Customer not found" };
      if (!canActOn(user, customer.ownerId)) return { ok: false, error: "This customer belongs to another user" };
      const closed = await closedDayError(tx, user.tenantId, billDate);
      if (closed) return { ok: false, error: closed, fieldErrors: { receiptDate: closed } };
      const pay = await checkPayment(tx, user.tenantId, v, amount);
      if ("error" in pay) return { ok: false, error: pay.error, fieldErrors: { [pay.field]: pay.error } };
      const common: LineCommon = {
        tenantId: user.tenantId,
        fy: financialYear(billDate),
        receiptDate: billDate,
        txnDate: dateOrToday(v.txnDate),
        notes: v.notes || null,
        mode: v.mode,
        modeName: pay.ok.modeName,
        accountId: pay.ok.accountId, // "Received into" (cash drawer for cash)
        reference: pay.ok.reference,
        bankName: pay.ok.bankName,
        netType: pay.ok.netType,
        createdById: user.id,
      };
      const whatsApp = (body: string, relatedType: string, relatedId: string) =>
        tx.messageLog.create({ data: { tenantId: user.tenantId, channel: "WhatsApp", to: customer.mobile, template: "receipt", body, relatedType, relatedId, createdById: user.id } });
      const thanks = (policy: Policy, receiptNo: string) =>
        `Thank you ${customer.name}. Received ${fmtINR(amount)} (${modeLabel(common)}) for ${policy.partner} ${policy.policyNumber}. Receipt ${receiptNo}.`;

      const addReceipt = (policy: Policy, lineAmount: Prisma.Decimal, extra: Partial<Prisma.ReceiptUncheckedCreateInput> = {}) =>
        addReceiptLine(tx, common, policy, customer, lineAmount, extra);

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
        const policy = await tx.policy.findUniqueOrThrow({ where: { id: slips[0].policyId } });
        const receipt = await addReceipt(policy, amount, { ownerPaid: true, denominations: pay.ok.denominations, notes: v.notes || `Owner-paid ${slips.map((s) => s.slipNo).join(", ")}` });
        await tx.ownerPaidSlip.updateMany({
          where: { id: { in: slipIds }, status: "CustomerOwes" },
          data: { status: "CollectedReturnToOwner", closedByReceiptId: receipt.id },
        });
        await whatsApp(thanks(policy, receipt.receiptNo), "Receipt", receipt.id);
        return { ok: true, id: receipt.id, href: `/receipts/${receipt.id}` };
      }

      if (!v.dues.length) {
        // Other payment: a policy but no instalment.
        const policy = await tx.policy.findFirst({ where: { id: v.policyId, customerId: customer.id } });
        if (!policy) return { ok: false, error: "Pick the dues being paid, or a policy for another payment", fieldErrors: { policyId: "Required" } };
        const receipt = await addReceipt(policy, amount, { denominations: pay.ok.denominations });
        await whatsApp(thanks(policy, receipt.receiptNo), "Receipt", receipt.id);
        return { ok: true, id: receipt.id, href: `/receipts/${receipt.id}` };
      }

      // Dues: the server picks the oldest `count` payable instalments of each policy and prices them.
      const picked = await pickDues(tx, user, v.dues, today, { customerId: customer.id });
      if ("error" in picked) return { ok: false, error: picked.error };
      const { lines } = picked;
      const total = sum(lines.map((l) => l.due.amount));
      if (!total.equals(amount)) {
        return { ok: false, error: `Amount must be ${fmtINR(total)} for the dues picked`, fieldErrors: { amount: "Mismatch" } };
      }

      const payment = lines.length > 1
        ? await tx.payment.create({
            data: {
              tenantId: user.tenantId, paymentNo: await nextNumber(tx, user.tenantId, "payment"), receiptDate: common.receiptDate, txnDate: common.txnDate,
              customerId: customer.id, amount, mode: v.mode, modeName: common.modeName, reference: common.reference, bankName: common.bankName, netType: common.netType, denominations: pay.ok.denominations,
              notes: v.notes || null, createdById: user.id,
            },
          })
        : null;
      const receipts = [];
      // Cash denomination is kept once: on the payment when several dues are paid together.
      for (const line of lines) receipts.push(await payDueLine(tx, common, line, { paymentId: payment?.id ?? null, ...(!payment && { denominations: pay.ok.denominations }) }));

      if (!payment) {
        await whatsApp(thanks(lines[0].policy, receipts[0].receiptNo), "Receipt", receipts[0].id);
        return { ok: true, id: receipts[0].id, href: `/receipts/${receipts[0].id}` };
      }
      const accountsPaid = [...new Set(lines.map((l) => l.policy.policyNumber))].join(", ");
      await whatsApp(
        `Thank you ${customer.name}. Received ${fmtINR(amount)} (${modeLabel(common)}) for ${lines.length} dues (${accountsPaid}). Payment receipt ${payment.paymentNo}.`,
        "Payment", payment.id,
      );
      return { ok: true, id: payment.id, href: `/payments/${payment.id}` };
    });
    if (result.ok) revalidatePath("/", "layout");
    return result;
  } catch (e) {
    if (e instanceof Refused) return e.result;
    throw e;
  }
}

const cancelSchema = z.object({ receiptId: z.string(), reason: z.string().trim().min(3, "Enter the reason") });

/** Undo one saved receipt: reversing Day Book entry dated today, instalment unpaid again, commission and slips reopened. */
async function reverseReceipt(tx: Tx, r: Receipt, ctx: { tenantId: string; userId: string; reason: string; today: Date }) {
  await tx.receipt.update({ where: { id: r.id }, data: { status: "Cancelled", cancelReason: ctx.reason, cancelledById: ctx.userId, cancelledAt: new Date() } });
  await reverseSource(tx, { tenantId: ctx.tenantId, sourceType: "Receipt", sourceId: r.id, entryDate: ctx.today, createdById: ctx.userId, reason: ctx.reason });
  const item = await tx.renewalItem.findFirst({ where: { paidReceiptId: r.id } });
  if (item) {
    await tx.renewalItem.update({
      where: { id: item.id },
      data: { status: item.dueDate < ctx.today ? "Overdue" : "Due", paidOn: null, paidReceiptId: null },
    });
  }
  await tx.commission.updateMany({ where: { receiptId: r.id }, data: { status: "Cancelled" } });
  await tx.ownerPaidSlip.updateMany({ where: { closedByReceiptId: r.id }, data: { status: "CustomerOwes", closedByReceiptId: null } });
}

const depositedAtPo = (r: Receipt) => r.rdStatus === "Deposited" || r.rdStatus === "Verified";

/** Admin / Super Admin only. The number is never reused; the Day Book gets a reversing entry dated today. */
async function cancelReceiptUnguarded(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Receipt.Cancel");
  const parsed = cancelSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { receiptId, reason } = parsed.data;
  const today = istToday();

  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const r = await tx.receipt.findFirst({ where: { id: receiptId, tenantId: user.tenantId }, include: { payment: { select: { paymentNo: true } } } });
    if (!r) return { ok: false, error: "Receipt not found" };
    if (r.status === "Cancelled") return { ok: false, error: "Already cancelled" };
    if (r.payment) return { ok: false, error: `Part of payment ${r.payment.paymentNo}; cancel the whole payment instead` };
    if (depositedAtPo(r)) return { ok: false, error: "Already deposited at the post office; it can't be cancelled here" };
    if (r.companyPaymentId) return { ok: false, error: "Already paid to the company; it can't be cancelled here" };
    await reverseReceipt(tx, r, { tenantId: user.tenantId, userId: user.id, reason, today });
    return { ok: true };
  });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

const cancelPaymentSchema = z.object({ paymentId: z.string(), reason: z.string().trim().min(3, "Enter the reason") });

/** Admin / Super Admin only: cancels every receipt line of the payment together. */
async function cancelPaymentUnguarded(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Receipt.Cancel");
  const parsed = cancelPaymentSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { paymentId, reason } = parsed.data;
  const today = istToday();

  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const p = await tx.payment.findFirst({ where: { id: paymentId, tenantId: user.tenantId }, include: { receipts: true } });
    if (!p) return { ok: false, error: "Payment not found" };
    if (p.status === "Cancelled") return { ok: false, error: "Already cancelled" };
    const deposited = p.receipts.filter(depositedAtPo);
    if (deposited.length) {
      return { ok: false, error: `${deposited.map((r) => r.receiptNo).join(", ")} already deposited at the post office; the payment can't be cancelled here` };
    }
    const paidOn = p.receipts.filter((r) => r.companyPaymentId);
    if (paidOn.length) {
      return { ok: false, error: `${paidOn.map((r) => r.receiptNo).join(", ")} already paid to the company; the payment can't be cancelled here` };
    }
    for (const r of p.receipts.filter((x) => x.status === "Saved")) {
      await reverseReceipt(tx, r, { tenantId: user.tenantId, userId: user.id, reason, today });
    }
    await tx.payment.update({ where: { id: p.id }, data: { status: "Cancelled", cancelReason: reason, cancelledById: user.id, cancelledAt: new Date() } });
    return { ok: true };
  });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

const ownerPaidSchema = z.object({
  renewalItemId: z.string().min(1, "Pick the bill"),
  poReceiptNo: z.string().trim().min(3, "Enter the reference no. (PO receipt no. or insurer receipt / transaction no.)").max(60),
});

/** The owner paid a customer's bill (RD at the post office, insurance premium to the insurer); no company money moves. */
export async function recordOwnerPaid(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Receipt.Create");
  const parsed = ownerPaidSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { renewalItemId, poReceiptNo } = parsed.data;
  const today = istToday();

  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const item = await tx.renewalItem.findFirst({
      where: { id: renewalItemId, tenantId: user.tenantId, status: { in: ["Due", "Overdue"] }, policy: OWNER_PAYABLE },
      include: { policy: true },
    });
    if (!item) return { ok: false, error: "That bill is not open" };
    if (!canActOn(user, item.policy.ownerId)) return { ok: false, error: "This account belongs to another user" };
    const slip = await tx.ownerPaidSlip.create({
      data: {
        tenantId: user.tenantId, slipNo: await nextNumber(tx, user.tenantId, "slip"), policyId: item.policyId,
        customerId: item.policy.customerId, renewalItemId: item.id, month: item.dueDate, amount: item.premiumAmount,
        poReceiptNo, createdById: user.id,
      },
    });
    await tx.renewalItem.update({ where: { id: item.id }, data: { status: "Paid", paidOn: today } });
    if (item.policy.productType === "PoRd") {
      await tx.commission.create({
        data: { tenantId: user.tenantId, sourceType: "RdReceipt", sourceNo: poReceiptNo, policyId: item.policyId, earnedOn: today, ...poCommission("PoRd", item.premiumAmount) },
      });
    }
    return { ok: true, id: slip.id };
  });
  if (result.ok) revalidatePath("/receipts");
  return result;
}

const returnSchema = z.object({ slipId: z.string().min(1, "Pick a slip"), mode: z.enum(["Cash", "Bank"]), denominations: denominationsField });

/** Hand the collected money back to the owner: Day Book outflow, slip settled. */
async function returnToOwnerUnguarded(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("DayBook.Create");
  const parsed = returnSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { slipId, mode, denominations } = parsed.data;
  const today = istToday();

  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const slip = await tx.ownerPaidSlip.findFirst({ where: { id: slipId, tenantId: user.tenantId, status: "CollectedReturnToOwner" } });
    if (!slip) return { ok: false, error: "Only slips the customer has paid can be returned" };
    const notes = mode === "Cash" ? checkDenominations(denominations, slip.amount) : null;
    if (notes && "error" in notes) return { ok: false, error: notes.error };
    const accounts = await cashAndBank(tx, user.tenantId);
    const [entry] = await postOwnerReturn(tx, slip, { accountId: mode === "Cash" ? accounts.cash.id : accounts.bank.id, mode, date: today, createdById: user.id, denominations: notes?.ok });
    await tx.ownerPaidSlip.update({
      where: { id: slip.id },
      data: { status: "Settled", returnedEntryId: entry.id, confirmedById: user.id, confirmedOn: new Date() },
    });
    return { ok: true };
  });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/**
 * "Share on WhatsApp" (mocked like every message): writes the share with the PDF link to the message log.
 * Receipts and payments go to the customer's number; direct bills to the payer's.
 */
export async function shareOnWhatsApp(kind: "Receipt" | "Payment" | "DirectBill", id: string): Promise<ActionResult> {
  const user = await authorize("Receipt.View");
  const found =
    kind === "Receipt" ? await db.receipt.findFirst({ where: { id, tenantId: user.tenantId }, include: { customer: true } }).then((r) => r && { no: r.receiptNo, amount: r.amount, name: r.customer.name, mobile: r.customer.mobile, ownerId: r.customer.ownerId, createdById: r.createdById, path: "receipts" })
    : kind === "Payment" ? await db.payment.findFirst({ where: { id, tenantId: user.tenantId }, include: { customer: true, receipts: { select: { customer: { select: { ownerId: true } } } } } })
      // Checked here (lines can belong to several customers); passes the check below as the user's own.
      .then((p) => p && canSeePayment(user, p) && { no: p.paymentNo, amount: p.amount, name: payerOf(p).name, mobile: payerOf(p).mobile, ownerId: null, createdById: user.id, path: "payments" })
    : await db.directBill.findFirst({ where: { id, tenantId: user.tenantId } }).then((b) => b && { no: b.billNo, amount: b.amount, name: b.payerName, mobile: b.payerMobile, ownerId: null, createdById: b.createdById, path: "direct-bills" });
  if (!found || !(seesAll(user.role) || found.createdById === user.id || (found.ownerId && canActOn(user, found.ownerId)))) return { ok: false, error: "Not found" };
  await db.messageLog.create({
    data: {
      tenantId: user.tenantId, channel: "WhatsApp", to: found.mobile, template: "receipt_share", relatedType: kind, relatedId: id, createdById: user.id,
      body: `Dear ${found.name}, here is your receipt ${found.no} for ${fmtINR(found.amount)} (PDF: /api/${found.path}/${id}/pdf). – IPower Investments`,
    },
  });
  return { ok: true };
}

export async function createReceipt(_: ActionResult, form: FormData): Promise<ActionResult> {
  return refuseOnClosedDay(() => createReceiptUnguarded(_, form));
}

export async function cancelReceipt(_: ActionResult, form: FormData): Promise<ActionResult> {
  return refuseOnClosedDay(() => cancelReceiptUnguarded(_, form));
}

export async function cancelPayment(_: ActionResult, form: FormData): Promise<ActionResult> {
  return refuseOnClosedDay(() => cancelPaymentUnguarded(_, form));
}

export async function returnToOwner(_: ActionResult, form: FormData): Promise<ActionResult> {
  return refuseOnClosedDay(() => returnToOwnerUnguarded(_, form));
}
