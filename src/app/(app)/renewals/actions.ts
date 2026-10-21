"use server";

import { revalidatePath } from "next/cache";
import { checkDenominations, denominationsField } from "@/lib/payment-options";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { refuseOnClosedDay } from "@/lib/action-guard";
import { audit } from "@/lib/audit";
import { assertDayOpen, balanceAt } from "@/lib/daybook";
import { fmtDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn } from "@/lib/leads";
import { MATURITY_SCHEMES } from "@/lib/lists";
import { fmtINR, sum } from "@/lib/money";
import { postCompanyPayment, PRODUCT_CATEGORY } from "@/lib/posting";
import { maturityDate } from "@/lib/renewals";
import { authorize } from "@/lib/session";

const fail = (error: string): ActionResult => ({ ok: false, error });

const companyPaymentSchema = z.object({
  receiptIds: z.string().transform((s) => s.split(",").filter(Boolean)).pipe(z.array(z.string()).min(1, "Tick the receipts being paid")),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date paid").transform((s) => new Date(`${s}T00:00:00Z`)),
  accountId: z.string().min(1, "Pick the account it was paid from"),
  reference: z.string().trim().min(2, "Enter the company receipt / UTR number").max(60),
  denominations: denominationsField, // when paid from office cash
});

/**
 * Pay to company: the ticked receipts (one insurer, AMC or the post office for SSA/PPF) were paid
 * on in one go. The money leaves the chosen account in the Day Book; RD goes through the PO deposit instead.
 */
export async function payToCompany(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("DayBook.Create");
  const parsed = companyPaymentSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;
  if (v.paidOn > istToday()) return fail("The paid date can't be in the future");

  const r = await refuseOnClosedDay(() =>
    db.$transaction(async (tx): Promise<ActionResult> => {
      await assertDayOpen(tx, user.tenantId, v.paidOn);
      const receipts = await tx.receipt.findMany({
        where: {
          id: { in: v.receiptIds }, tenantId: user.tenantId, status: "Saved", ownerPaid: false, rdStatus: null, companyPaymentId: null,
          policy: { productType: { not: "PoRd" } },
        },
        include: { policy: true },
      });
      if (receipts.length !== v.receiptIds.length) return fail("Some receipts are no longer waiting to be paid to the company; reload and try again");
      if (receipts.some((x) => !canActOn(user, x.policy!.ownerId))) return fail("Some receipts belong to another user's customers");
      const companies = [...new Set(receipts.map((x) => x.policy!.partner))];
      if (companies.length > 1) return fail(`Tick receipts for one company at a time (${companies.join(", ")})`);
      const late = receipts.find((x) => x.receiptDate > v.paidOn);
      if (late) return fail(`${late.receiptNo} was collected on ${fmtDate(late.receiptDate)}, after the paid date`);
      const account = await tx.account.findFirst({ where: { id: v.accountId, tenantId: user.tenantId, type: { in: ["Cash", "Bank"] }, active: true } });
      if (!account) return fail("Pick the cash or bank account it was paid from");
      const amount = sum(receipts.map((x) => x.amount));
      const balance = await balanceAt(tx, account.id, v.paidOn);
      if (balance.lt(amount)) return fail(`${account.name} has only ${fmtINR(balance)}`);
      const notes = account.type === "Cash" ? checkDenominations(v.denominations, amount) : null;
      if (notes && "error" in notes) return fail(notes.error);

      const payment = await tx.companyPayment.create({
        data: {
          tenantId: user.tenantId, company: companies[0], paidOn: v.paidOn, accountId: account.id, mode: account.type === "Cash" ? "Cash" : "Bank",
          amount, reference: v.reference, createdById: user.id,
        },
      });
      const updated = await tx.receipt.updateMany({ where: { id: { in: receipts.map((x) => x.id) }, companyPaymentId: null }, data: { companyPaymentId: payment.id } });
      if (updated.count !== receipts.length) throw new Error("Receipts changed while saving; try again");
      await postCompanyPayment(tx, payment, { receiptCount: receipts.length, productCategory: PRODUCT_CATEGORY[receipts[0].policy!.productType], denominations: notes?.ok });
      return { ok: true };
    }),
  );
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/** A one-time post office deposit has been paid out: it leaves the Overdue maturity list. */
export async function markMatured(policyId: string): Promise<ActionResult> {
  const user = await authorize("Renewal.View");
  const policy = await db.policy.findFirst({ where: { id: policyId, tenantId: user.tenantId, status: "Active", productType: { in: MATURITY_SCHEMES } } });
  if (!policy) return { ok: false, error: "This deposit is no longer active" };
  if (!canActOn(user, policy.ownerId)) return { ok: false, error: "This account belongs to another user" };
  const matures = maturityDate(policy);
  if (!matures || matures > istToday()) return { ok: false, error: "This deposit has not matured yet" };
  await db.policy.update({ where: { id: policy.id }, data: { status: "Matured", closedOn: matures } });
  revalidatePath("/renewals");
  return { ok: true };
}

/** "Send now" (mocked): writes the WhatsApp reminder to the message log. */
export async function sendRenewalReminder(renewalItemId: string): Promise<ActionResult> {
  const user = await authorize("Renewal.View");
  const item = await db.renewalItem.findFirst({
    where: { id: renewalItemId, tenantId: user.tenantId, status: { in: ["Due", "Overdue"] } },
    include: { policy: { include: { customer: true } } },
  });
  if (!item) return { ok: false, error: "This renewal is no longer due" };
  // Reminders stop once a policy is closed early, withdrawn, matured or not renewed.
  if (item.policy.status !== "Active") return { ok: false, error: "This policy is no longer active; no reminder is sent" };
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
    db.renewalItem.update({ where: { id: item.id }, data: { lastReminderAt: new Date(), reminderCount: { increment: 1 } } }),
  ]);
  revalidatePath("/renewals");
  return { ok: true };
}

/**
 * "Not renewed": the customer won't pay this overdue renewal. The policy becomes Lapsed (Not renewed tab), its
 * unpaid instalments Lapsed, and reminders stop. Logged with the reason.
 */
export async function markNotRenewed(renewalItemId: string, reason: string): Promise<ActionResult> {
  const user = await authorize("Renewal.View");
  const why = reason.trim();
  if (why.length < 3) return { ok: false, error: "Enter why it was not renewed" };
  const item = await db.renewalItem.findFirst({ where: { id: renewalItemId, tenantId: user.tenantId, status: "Overdue" }, include: { policy: { include: { customer: { select: { name: true } } } } } });
  if (!item) return { ok: false, error: "Only an overdue renewal can be marked not renewed" };
  if (!canActOn(user, item.policy.ownerId)) return { ok: false, error: "This policy belongs to another user" };
  if (item.policy.status !== "Active") return { ok: false, error: "This policy is no longer active" };
  const today = istToday();
  await db.$transaction(async (tx) => {
    await tx.policy.update({ where: { id: item.policyId }, data: { status: "Lapsed", closedOn: today, closeReason: why } });
    const lapsed = await tx.renewalItem.updateMany({ where: { policyId: item.policyId, status: { in: ["Due", "Overdue"] } }, data: { status: "Lapsed" } });
    await audit(tx, user, {
      entity: "Policy", entityId: item.policyId, action: "Not renewed",
      summary: `${item.policy.customer.name} · ${item.policy.partner} ${item.policy.productName} ${item.policy.policyNumber} not renewed · ${lapsed.count} unpaid instalment(s) lapsed`,
      before: { status: "Active" }, after: { status: "Lapsed", date: fmtDate(today) }, reason: why,
    });
  });
  revalidatePath("/renewals");
  return { ok: true };
}

/** "Send maturity reminder" (mocked): tells the customer their scheme matures soon. */
export async function sendMaturityReminder(policyId: string): Promise<ActionResult> {
  const user = await authorize("Renewal.View");
  const policy = await db.policy.findFirst({ where: { id: policyId, tenantId: user.tenantId, status: "Active" }, include: { customer: true } });
  if (!policy) return { ok: false, error: "This policy is no longer active" };
  if (!canActOn(user, policy.ownerId)) return { ok: false, error: "This policy belongs to another user" };
  const matures = maturityDate(policy);
  if (!matures) return { ok: false, error: "This policy has no maturity date" };
  const what = policy.productType === "Insurance" || policy.productType === "MutualFund" ? `${policy.partner} ${policy.productName} (${policy.policyNumber})` : `${policy.productName} ${policy.policyNumber}`;
  await db.messageLog.create({
    data: {
      tenantId: user.tenantId, channel: "WhatsApp", to: policy.customer.mobile, template: "maturity_reminder",
      body: `Dear ${policy.customer.name}, your ${what} ${matures < istToday() ? "matured" : "matures"} on ${fmtDate(matures)}. Please visit our office to plan the maturity amount. – IPower Investments - R. Murali`,
      relatedType: "Policy", relatedId: policy.id, createdById: user.id,
    },
  });
  revalidatePath("/renewals");
  return { ok: true };
}
