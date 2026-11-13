import type { PaymentMode, Policy, Prisma } from "@prisma/client";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { poCommission } from "@/lib/commission";
import type { Tx } from "@/lib/db";
import { ADVANCE_MONTHS, lockPolicyDues, payableDues, type Due } from "@/lib/dues";
import { canWorkOn } from "@/lib/leads";
import { lineNumber, nextNumber } from "@/lib/numbering";
import { billEnd } from "@/lib/policies";
import { postReceipt } from "@/lib/posting";
import type { SessionUser } from "@/lib/session";
import { z } from "zod";
import { fmtDate, istToday } from "@/lib/dates";

// Receipt lines shared by every way of taking money for bills: one customer's receipt, a combined receipt
// across customers, and a bill-group receipt. Each paid bill gets its own RCPT under its own customer.

export const moneyField = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount").refine((v) => Number(v) > 0, "Amount must be more than 0");
/** "" or missing = today. Past dates are allowed; a closed Day Book day is refused when posting. */
export const pastOrTodayField = z.union([
  z.literal(""),
  z.iso.date("Pick a date").refine((d) => new Date(`${d}T00:00:00Z`) <= istToday(), "Date can't be in the future"),
]).optional();
export const dateOrToday = (d: string | undefined) => (d ? new Date(`${d}T00:00:00Z`) : istToday());

const duesSchema = z.array(z.object({ policyId: z.string().min(1), count: z.number().int().min(1).max(60) })).max(200);
const parseJson = (v: string): unknown => {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};
/** Dues picked per policy as JSON [{ policyId, count }]: the oldest `count` payable instalments of each. */
export const duesField = z.string().optional().transform((v, ctx) => {
  if (!v) return [];
  const parsed = duesSchema.safeParse(parseJson(v));
  if (!parsed.success) {
    ctx.addIssue({ code: "custom", message: "Pick the dues again" });
    return z.NEVER;
  }
  return parsed.data;
});

/** Thrown inside a transaction to roll back everything already written. */
export class Refused extends Error {
  constructor(public result: ActionResult) {
    super(result.error);
  }
}

/** What every receipt line of one payment shares. */
export type LineCommon = {
  tenantId: string; fy: string; receiptDate: Date; txnDate: Date; mode: PaymentMode; accountId: string;
  modeName: string | null; reference: string | null; bankName: string | null; netType: string | null; createdById: string; notes: string | null;
};

/**
 * Balances run from the first entry, so a bill dated before a closed day would change that day's verified figures.
 * Only days after the last close can be back-dated (a closed bill date itself is refused on posting).
 */
export async function closedDayError(tx: Tx, tenantId: string, billDate: Date) {
  const lastClose = await tx.dayClose.findFirst({ where: { tenantId, status: "Closed" }, orderBy: { date: "desc" }, select: { date: true } });
  return lastClose && billDate < lastClose.date ? `Day Book is closed up to ${fmtDate(lastClose.date)}; pick a later bill date` : null;
}

export type DueLine = { policy: Policy; customerId: string; customerName: string; due: Due };

/**
 * The dues picked as `{ policyId, count }`: the oldest `count` payable instalments of each policy, re-derived and
 * priced here (never taken from the browser). Every policy must be active, in the user's tenant and on a customer
 * the user may act on; `customerId` limits them to one customer, `members` to a bill group, and `openOnly` to bills
 * already raised (no advance instalments). Policies are locked in id order, so payments over the same policies
 * can't deadlock.
 */
export async function pickDues(
  tx: Tx, user: SessionUser, picks: { policyId: string; count: number }[], today: Date,
  opts: { customerId?: string; members?: Set<string>; openOnly?: boolean } = {},
): Promise<{ lines: DueLine[] } | { error: string }> {
  const ids = picks.map((p) => p.policyId);
  if (new Set(ids).size !== ids.length) return { error: "Pick the dues again" };
  const lines: DueLine[] = [];
  for (const { policyId, count } of [...picks].sort((a, b) => a.policyId.localeCompare(b.policyId))) {
    const policy = await tx.policy.findFirst({
      where: { id: policyId, tenantId: user.tenantId, status: "Active", ...(opts.customerId && { customerId: opts.customerId }) },
      include: { product: { select: { invoiceRule: true } }, customer: { select: { name: true, ownerId: true } } },
    });
    if (!policy) return { error: "A policy picked is not active for this customer; reload and try again" };
    if (!canWorkOn(user, policy.customer.ownerId)) return { error: `${policy.policyNumber} belongs to another user's customer` };
    if (opts.members && !opts.members.has(policy.id)) return { error: `${policy.policyNumber} is not in this bill group` };
    await lockPolicyDues(tx, policy.id);
    const stored = await tx.renewalItem.findMany({ where: { policyId: policy.id } });
    const payable = payableDues({ ...policy, billUntil: billEnd(policy, policy.product?.invoiceRule) }, stored, today)
      .filter((d) => !opts.openOnly || d.itemId);
    if (count > payable.length) {
      return { error: `${policy.policyNumber}: only ${payable.length} ${opts.openOnly ? "open bill(s)" : `instalment(s) can be paid now (up to ${ADVANCE_MONTHS} months ahead)`}` };
    }
    for (const due of payable.slice(0, count)) lines.push({ policy, customerId: policy.customerId, customerName: policy.customer.name, due });
  }
  return { lines };
}

/**
 * The number of a receipt line: its own AA- number for a receipt for one bill, or – inside one receipt for several
 * bills (#45) – that receipt's number with the line's position, AA-05/1, AA-05/2 … (no AA- number is used up).
 */
async function receiptLineNo(tx: Tx, tenantId: string, paymentId: string | null | undefined) {
  if (!paymentId) return nextNumber(tx, tenantId, "receipt");
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { paymentNo: true, _count: { select: { receipts: true } } } });
  return lineNumber(payment.paymentNo, payment._count.receipts + 1);
}

/** One receipt line for one policy: Day Book in; RD → Collected + commission expected. Numbered at insert time. */
export async function addReceiptLine(
  tx: Tx, common: LineCommon, policy: Policy, customer: { id: string; name: string }, amount: Prisma.Decimal,
  extra: Partial<Prisma.ReceiptUncheckedCreateInput> = {},
) {
  const isRd = policy.productType === "PoRd" && !extra.ownerPaid;
  const receipt = await tx.receipt.create({
    data: {
      ...common, customerId: customer.id, receiptNo: await receiptLineNo(tx, common.tenantId, extra.paymentId), amount,
      policyId: policy.id, rdStatus: isRd ? "Collected" : null, ...extra,
    },
  });
  if (isRd) {
    await tx.commission.create({
      data: { tenantId: common.tenantId, sourceType: "RdReceipt", sourceNo: receipt.receiptNo, policyId: policy.id, receiptId: receipt.id, earnedOn: common.receiptDate, ...poCommission("PoRd", amount) },
    });
  }
  await postReceipt(tx, receipt, { customerName: customer.name, policy });
  return receipt;
}

/** Pays one due: its RCPT line, the bill marked Paid (an advance instalment is stored now, already paid). */
export async function payDueLine(tx: Tx, common: LineCommon, line: DueLine, extra: Partial<Prisma.ReceiptUncheckedCreateInput> = {}) {
  const { policy, due } = line;
  const receipt = await addReceiptLine(tx, common, policy, { id: line.customerId, name: line.customerName }, due.amount, { renewalItemId: due.itemId, ...extra });
  if (due.itemId) {
    const paid = await tx.renewalItem.updateMany({
      where: { id: due.itemId, status: { in: ["Due", "Overdue"] } },
      data: { status: "Paid", paidOn: common.receiptDate, paidReceiptId: receipt.id },
    });
    if (paid.count !== 1) throw new Refused({ ok: false, error: "An instalment picked was just paid by someone else; reload and try again" });
  } else {
    const item = await tx.renewalItem.create({
      data: { tenantId: common.tenantId, policyId: policy.id, dueDate: due.dueDate, premiumAmount: due.amount, status: "Paid", paidOn: common.receiptDate, paidReceiptId: receipt.id },
    });
    await tx.receipt.update({ where: { id: receipt.id }, data: { renewalItemId: item.id } });
  }
  return receipt;
}
