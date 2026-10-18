"use server";

import type { Policy, Prisma, Receipt } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { refuseOnClosedDay } from "@/lib/action-guard";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { cashAndBank, receivingAccountId } from "@/lib/accounts";
import { poCommission } from "@/lib/commission";
import { reverseSource } from "@/lib/daybook";
import { financialYear, fmtDate, istToday } from "@/lib/dates";
import { db, type Tx } from "@/lib/db";
import { canActOn } from "@/lib/leads";
import { D, fmtINR, sum } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import { postOwnerReturn, postReceipt } from "@/lib/posting";
import { ADVANCE_MONTHS, lockPolicyDues, payableDues, type Due } from "@/lib/dues";
import { authorize } from "@/lib/session";

const money = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount").refine((v) => Number(v) > 0, "Amount must be more than 0");
// "" or missing = today. Past dates are allowed; a closed Day Book day is refused when posting.
const pastOrToday = z.union([
  z.literal(""),
  z.iso.date("Pick a date").refine((d) => new Date(`${d}T00:00:00Z`) <= istToday(), "Date can't be in the future"),
]).optional();
const dateOrToday = (d: string | undefined) => (d ? new Date(`${d}T00:00:00Z`) : istToday());

const duesSchema = z.array(z.object({ policyId: z.string().min(1), count: z.number().int().min(1).max(60) })).max(20);

const parseJson = (v: string): unknown => {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

const receiptSchema = z
  .object({
    customerId: z.string().min(1),
    policyId: z.string(), // "other payment" (no instalment) only
    // Dues picked per policy as JSON [{ policyId, count }]: the oldest `count` payable instalments of each.
    dues: z.string().optional().transform((v, ctx) => {
      if (!v) return [];
      const parsed = duesSchema.safeParse(parseJson(v));
      if (!parsed.success) {
        ctx.addIssue({ code: "custom", message: "Pick the dues again" });
        return z.NEVER;
      }
      return parsed.data;
    }),
    amount: money,
    mode: z.enum(["Cash", "UPI", "Cheque"]),
    reference: z.string().trim().max(40),
    notes: z.string().trim().max(200),
    slipIds: z.string(), // comma-separated owner-paid slips to close with this payment
    receiptDate: pastOrToday, // bill date
    txnDate: pastOrToday, // when the customer actually paid
  })
  .refine((v) => v.mode === "Cash" || v.reference, { message: "Enter the UTR or cheque number", path: ["reference"] });

/** Thrown inside a transaction to roll back everything already written. */
class Refused extends Error {
  constructor(public result: ActionResult) {
    super(result.error);
  }
}

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
      // Balances run from the first entry, so a bill dated before a closed day would change that day's verified
      // figures. Only days after the last close can be back-dated (a closed bill date itself is refused on posting).
      const lastClose = await tx.dayClose.findFirst({ where: { tenantId: user.tenantId, status: "Closed" }, orderBy: { date: "desc" }, select: { date: true } });
      if (lastClose && billDate < lastClose.date) {
        const msg = `Day Book is closed up to ${fmtDate(lastClose.date)}; pick a later bill date`;
        return { ok: false, error: msg, fieldErrors: { receiptDate: msg } };
      }
      const accounts = await cashAndBank(tx, user.tenantId);
      const common = {
        tenantId: user.tenantId,
        fy: financialYear(billDate),
        receiptDate: billDate,
        txnDate: dateOrToday(v.txnDate),
        customerId: customer.id,
        mode: v.mode,
        accountId: receivingAccountId(v.mode, accounts),
        reference: v.reference || null,
        createdById: user.id,
      };
      const whatsApp = (body: string, relatedType: string, relatedId: string) =>
        tx.messageLog.create({ data: { tenantId: user.tenantId, channel: "WhatsApp", to: customer.mobile, template: "receipt", body, relatedType, relatedId, createdById: user.id } });
      const thanks = (policy: Policy, receiptNo: string) =>
        `Thank you ${customer.name}. Received ${fmtINR(amount)} (${v.mode}) for ${policy.partner} ${policy.policyNumber}. Receipt ${receiptNo}.`;

      /** One RCPT for one policy: Day Book in; RD → Collected + commission expected. Numbered at insert time. */
      const addReceipt = async (policy: Policy, lineAmount: Prisma.Decimal, extra: Partial<Prisma.ReceiptUncheckedCreateInput> = {}) => {
        const isRd = policy.productType === "PoRd" && !extra.ownerPaid;
        const receipt = await tx.receipt.create({
          data: {
            ...common, receiptNo: await nextNumber(tx, user.tenantId, "receipt"), amount: lineAmount, notes: v.notes || null,
            policyId: policy.id, rdStatus: isRd ? "Collected" : null, ...extra,
          },
        });
        if (isRd) {
          await tx.commission.create({
            data: { tenantId: user.tenantId, sourceType: "RdReceipt", sourceNo: receipt.receiptNo, policyId: policy.id, receiptId: receipt.id, earnedOn: billDate, ...poCommission("PoRd", lineAmount) },
          });
        }
        await postReceipt(tx, receipt, { customerName: customer.name, policy });
        return receipt;
      };

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
        const receipt = await addReceipt(policy, amount, { ownerPaid: true, notes: v.notes || `Owner-paid ${slips.map((s) => s.slipNo).join(", ")}` });
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
        const receipt = await addReceipt(policy, amount);
        await whatsApp(thanks(policy, receipt.receiptNo), "Receipt", receipt.id);
        return { ok: true, id: receipt.id, href: `/receipts/${receipt.id}` };
      }

      // Dues: the server picks the oldest `count` payable instalments of each policy and prices them.
      const lines: { policy: Policy; due: Due }[] = [];
      for (const { policyId, count } of v.dues) {
        const policy = await tx.policy.findFirst({ where: { id: policyId, customerId: customer.id, status: "Active" } });
        if (!policy) return { ok: false, error: "A policy picked is not active for this customer; reload and try again" };
        if (lines.some((l) => l.policy.id === policy.id)) return { ok: false, error: "Pick the dues again" };
        await lockPolicyDues(tx, policy.id);
        const stored = await tx.renewalItem.findMany({ where: { policyId: policy.id } });
        const payable = payableDues(policy, stored, today);
        if (count > payable.length) {
          return { ok: false, error: `${policy.policyNumber}: only ${payable.length} instalment(s) can be paid now (up to ${ADVANCE_MONTHS} months ahead)` };
        }
        for (const due of payable.slice(0, count)) lines.push({ policy, due });
      }
      const total = sum(lines.map((l) => l.due.amount));
      if (!total.equals(amount)) {
        return { ok: false, error: `Amount must be ${fmtINR(total)} for the dues picked`, fieldErrors: { amount: "Mismatch" } };
      }

      const payment = lines.length > 1
        ? await tx.payment.create({
            data: {
              tenantId: user.tenantId, paymentNo: await nextNumber(tx, user.tenantId, "payment"), receiptDate: common.receiptDate, txnDate: common.txnDate,
              customerId: customer.id, amount, mode: v.mode, reference: common.reference, notes: v.notes || null, createdById: user.id,
            },
          })
        : null;
      const receipts = [];
      for (const { policy, due } of lines) {
        const receipt = await addReceipt(policy, due.amount, { paymentId: payment?.id ?? null, renewalItemId: due.itemId });
        if (due.itemId) {
          const paid = await tx.renewalItem.updateMany({
            where: { id: due.itemId, status: { in: ["Due", "Overdue"] } },
            data: { status: "Paid", paidOn: billDate, paidReceiptId: receipt.id },
          });
          if (paid.count !== 1) throw new Refused({ ok: false, error: "An instalment picked was just paid by someone else; reload and try again" });
        } else {
          // Advance instalment: stored now, already paid.
          const item = await tx.renewalItem.create({
            data: { tenantId: user.tenantId, policyId: policy.id, dueDate: due.dueDate, premiumAmount: due.amount, status: "Paid", paidOn: billDate, paidReceiptId: receipt.id },
          });
          await tx.receipt.update({ where: { id: receipt.id }, data: { renewalItemId: item.id } });
        }
        receipts.push(receipt);
      }

      if (!payment) {
        await whatsApp(thanks(lines[0].policy, receipts[0].receiptNo), "Receipt", receipts[0].id);
        return { ok: true, id: receipts[0].id, href: `/receipts/${receipts[0].id}` };
      }
      const accountsPaid = [...new Set(lines.map((l) => l.policy.policyNumber))].join(", ");
      await whatsApp(
        `Thank you ${customer.name}. Received ${fmtINR(amount)} (${v.mode}) for ${lines.length} dues (${accountsPaid}). Payment receipt ${payment.paymentNo}.`,
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

export async function cancelPayment(_: ActionResult, form: FormData): Promise<ActionResult> {
  return refuseOnClosedDay(() => cancelPaymentUnguarded(_, form));
}

export async function returnToOwner(_: ActionResult, form: FormData): Promise<ActionResult> {
  return refuseOnClosedDay(() => returnToOwnerUnguarded(_, form));
}
