"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { refuseOnClosedDay } from "@/lib/action-guard";
import { audit } from "@/lib/audit";
import { financialYear, fmtDate, istToday } from "@/lib/dates";
import { db, type Tx } from "@/lib/db";
import { lockPolicyDues, payableDues } from "@/lib/dues";
import { canWorkOn } from "@/lib/leads";
import { D, fmtINR, sum } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import { checkPayment, modeLabel, payFields } from "@/lib/payment-options";
import { billEnd } from "@/lib/policies";
import { PAY_MODE_LABEL } from "@/lib/products";
import { closedDayError, dateOrToday, duesField, type LineCommon, moneyField, pastOrTodayField, payDueLine, pickDues, Refused } from "@/lib/receipt-lines";
import { authorize, type SessionUser } from "@/lib/session";

const mobile = z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number");
const firstIssue = (e: z.ZodError): ActionResult => {
  const i = e.issues[0];
  return { ok: false, error: i.message, fieldErrors: { [String(i.path[0])]: i.message } };
};

// ── Bill groups (#21): Admin / Super Admin only ──

const groupSchema = z.object({
  name: z.string().trim().min(2, "Enter the group name").max(80),
  contactName: z.string().trim().max(80).default(""),
  contactMobile: z.union([z.literal(""), mobile]).default(""),
});

export async function createBillGroup(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("BillGroup.Manage");
  const parsed = groupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;
  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    if (await tx.billGroup.findFirst({ where: { tenantId: user.tenantId, name: { equals: v.name, mode: "insensitive" } } })) {
      return { ok: false, error: "A bill group with this name already exists", fieldErrors: { name: "Already used" } };
    }
    const g = await tx.billGroup.create({
      data: { tenantId: user.tenantId, name: v.name, contactName: v.contactName || null, contactMobile: v.contactMobile || null, createdById: user.id },
    });
    await audit(tx, user, { entity: "BillGroup", entityId: g.id, action: "Create", summary: `Bill group ${g.name}` });
    return { ok: true, id: g.id, href: `/receipts/groups/${g.id}` };
  });
  if (result.ok) revalidatePath("/receipts/groups");
  return result;
}

const memberSchema = z.object({ billGroupId: z.string().min(1), policyNumber: z.string().trim().min(1, "Enter the policy / account no.") });

const MEMBER_INCLUDE = {
  customer: { select: { name: true, cifNo: true } },
  billGroup: { include: { billGroup: { select: { name: true } } } },
} satisfies Prisma.PolicyInclude;
type PolicyForGroup = Prisma.PolicyGetPayload<{ include: typeof MEMBER_INCLUDE }>;

/** Why a policy can't join this group (null = it can). A policy can be in only one group, so no bill is billed twice. */
function joinProblem(policy: PolicyForGroup, billGroupId: string): string | null {
  if (policy.status !== "Active") return `${policy.policyNumber} is not active`;
  if (policy.frequency === "OneTime") return `${policy.policyNumber} is a one-time deposit and has no bills`;
  if (policy.billGroup) return policy.billGroup.billGroupId === billGroupId ? "Already in this group" : `Already in bill group ${policy.billGroup.billGroup.name}`;
  return null;
}

async function addMembers(tx: Tx, user: SessionUser, group: { id: string; name: string }, policies: PolicyForGroup[]) {
  for (const policy of policies) {
    await tx.billGroupMember.create({ data: { billGroupId: group.id, policyId: policy.id, addedById: user.id } });
    await audit(tx, user, { entity: "BillGroup", entityId: group.id, action: "AddPolicy", summary: `${policy.policyNumber} (${policy.customer.name}) added to ${group.name}` });
  }
}

/** Adds a policy / account to a group by its exact number. */
export async function addBillGroupMember(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("BillGroup.Manage");
  const parsed = memberSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);
  const { billGroupId, policyNumber } = parsed.data;
  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const group = await tx.billGroup.findFirst({ where: { id: billGroupId, tenantId: user.tenantId } });
    if (!group) return { ok: false, error: "Bill group not found" };
    const policy = await tx.policy.findFirst({ where: { tenantId: user.tenantId, policyNumber: { equals: policyNumber, mode: "insensitive" } }, include: MEMBER_INCLUDE });
    if (!policy) return { ok: false, error: `No policy / account ${policyNumber}`, fieldErrors: { policyNumber: "Not found" } };
    const problem = joinProblem(policy, group.id);
    if (problem) return { ok: false, error: problem, fieldErrors: { policyNumber: problem } };
    await addMembers(tx, user, group, [policy]);
    return { ok: true };
  });
  if (result.ok) revalidatePath(`/receipts/groups/${billGroupId}`);
  return result;
}

/** A policy found by "Find policies to add", with the reason it can't join (if any). */
export type GroupPolicyHit = { id: string; customer: string; cifNo: string; policyNumber: string; product: string; payMode: string; problem: string | null };

/**
 * "Find policies to add": active policies of customers matching a name or mobile, or whose policy /
 * account no. contains the text. Policies that can't join show why instead of a tick box.
 */
export async function findPoliciesForGroup(billGroupId: string, q: string): Promise<{ hits: GroupPolicyHit[]; more: boolean } | { error: string }> {
  const user = await authorize("BillGroup.Manage");
  const text = q.trim();
  if (text.length < 2) return { error: "Type at least 2 letters or digits" };
  const contains = { contains: text, mode: "insensitive" as const };
  const policies = await db.policy.findMany({
    where: {
      tenantId: user.tenantId, status: "Active",
      OR: [
        { policyNumber: contains },
        { customer: { OR: [{ name: contains }, { mobile: { contains: text } }, { mobiles: { some: { number: { contains: text } } } }] } },
      ],
    },
    include: MEMBER_INCLUDE,
    orderBy: [{ customer: { name: "asc" } }, { policyNumber: "asc" }],
    take: 41,
  });
  return {
    more: policies.length > 40,
    hits: policies.slice(0, 40).map((p) => ({
      id: p.id, customer: p.customer.name, cifNo: p.customer.cifNo, policyNumber: p.policyNumber,
      product: `${p.partner} ${p.productName}`, payMode: PAY_MODE_LABEL[p.frequency], problem: joinProblem(p, billGroupId),
    })),
  };
}

/** Adds the policies ticked in "Find policies to add" – all or none, with the same rules as adding by number. */
export async function addBillGroupMembers(billGroupId: string, policyIds: string[]): Promise<ActionResult> {
  const user = await authorize("BillGroup.Manage");
  const ids = [...new Set(policyIds)];
  if (!ids.length) return { ok: false, error: "Tick the policies to add" };
  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const group = await tx.billGroup.findFirst({ where: { id: billGroupId, tenantId: user.tenantId } });
    if (!group) return { ok: false, error: "Bill group not found" };
    const policies = await tx.policy.findMany({ where: { tenantId: user.tenantId, id: { in: ids } }, include: MEMBER_INCLUDE });
    if (policies.length !== ids.length) return { ok: false, error: "A ticked policy was not found; search again" };
    const problem = policies.map((p) => joinProblem(p, group.id)).find(Boolean);
    if (problem) return { ok: false, error: `${problem}; search again` };
    await addMembers(tx, user, group, policies);
    return { ok: true, message: `${policies.length} ${policies.length === 1 ? "policy" : "policies"} added to ${group.name}` };
  });
  if (result.ok) revalidatePath(`/receipts/groups/${billGroupId}`);
  return result;
}

export async function removeBillGroupMember(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("BillGroup.Manage");
  const memberId = String(form.get("memberId") ?? "");
  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const m = await tx.billGroupMember.findFirst({
      where: { id: memberId, billGroup: { tenantId: user.tenantId } },
      include: { billGroup: true, policy: { select: { policyNumber: true } } },
    });
    if (!m) return { ok: false, error: "Not found" };
    await tx.billGroupMember.delete({ where: { id: m.id } });
    await audit(tx, user, { entity: "BillGroup", entityId: m.billGroupId, action: "RemovePolicy", summary: `${m.policy.policyNumber} removed from ${m.billGroup.name}` });
    return { ok: true, id: m.billGroupId };
  });
  if (result.ok) revalidatePath(`/receipts/groups/${result.id}`);
  return result;
}

// ── Combined (#5) and bill-group (#21) receipts: one AA- receipt, one line (AA-05/1 …) per bill under its own customer ──

const groupReceiptSchema = z.object({
  kind: z.enum(["Combined", "BillGroup"]),
  billGroupId: z.string().default(""),
  dues: duesField,
  amount: moneyField,
  ...payFields,
  payerName: z.string().trim().min(2, "Enter who paid").max(80),
  payerMobile: mobile,
  poReceiptNo: z.string().trim().max(60).default(""),
  notes: z.string().trim().max(200).default(""),
  receiptDate: pastOrTodayField,
  txnDate: pastOrTodayField,
});

async function createGroupReceiptUnguarded(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Receipt.Create");
  const parsed = groupReceiptSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);
  const v = parsed.data;
  if (!v.dues.length) return { ok: false, error: "Tick the bills being paid" };
  const amount = new D(v.amount);
  const billDate = dateOrToday(v.receiptDate);
  const today = istToday();

  try {
    const result = await db.$transaction(async (tx): Promise<ActionResult> => {
      const closed = await closedDayError(tx, user.tenantId, billDate);
      if (closed) return { ok: false, error: closed, fieldErrors: { receiptDate: closed } };
      let members: Set<string> | undefined;
      if (v.kind === "BillGroup") {
        const group = await tx.billGroup.findFirst({ where: { id: v.billGroupId, tenantId: user.tenantId }, include: { members: { select: { policyId: true } } } });
        if (!group) return { ok: false, error: "Bill group not found" };
        members = new Set(group.members.map((m) => m.policyId));
      }
      const pay = await checkPayment(tx, user.tenantId, v, amount);
      if ("error" in pay) return { ok: false, error: pay.error, fieldErrors: { [pay.field]: pay.error } };
      // Combined: bills already raised only. Bill group: advance instalments too (like a customer's own receipt).
      const picked = await pickDues(tx, user, v.dues, today, { members, openOnly: v.kind === "Combined" });
      if ("error" in picked) return { ok: false, error: picked.error };
      const { lines } = picked;
      const total = sum(lines.map((l) => l.due.amount));
      if (!total.equals(amount)) return { ok: false, error: `Amount must be ${fmtINR(total)} for the bills ticked`, fieldErrors: { amount: "Mismatch" } };

      const common: LineCommon = {
        tenantId: user.tenantId, fy: financialYear(billDate), receiptDate: billDate, txnDate: dateOrToday(v.txnDate), mode: v.mode, modeName: pay.ok.modeName,
        accountId: pay.ok.accountId, reference: pay.ok.reference, bankName: pay.ok.bankName, netType: pay.ok.netType, createdById: user.id, notes: v.notes || null,
      };
      const payment = await tx.payment.create({
        data: {
          tenantId: user.tenantId, paymentNo: await nextNumber(tx, user.tenantId, "receipt"), kind: v.kind, billGroupId: members ? v.billGroupId : null,
          receiptDate: billDate, txnDate: common.txnDate, customerId: null, payerName: v.payerName, payerMobile: v.payerMobile, poReceiptNo: v.poReceiptNo || null,
          amount, mode: v.mode, modeName: common.modeName, reference: common.reference, bankName: common.bankName, netType: common.netType, denominations: pay.ok.denominations,
          notes: common.notes, createdById: user.id,
        },
      });
      for (const line of lines) await payDueLine(tx, common, line, { paymentId: payment.id });
      const customers = new Set(lines.map((l) => l.customerId)).size;
      await tx.messageLog.create({
        data: {
          tenantId: user.tenantId, channel: "WhatsApp", to: v.payerMobile, template: "receipt", relatedType: "Payment", relatedId: payment.id, createdById: user.id,
          body: `Thank you ${v.payerName}. Received ${fmtINR(amount)} (${modeLabel(common)}) for ${lines.length} bill(s) of ${customers} customer(s). Receipt ${payment.paymentNo}.`,
        },
      });
      return { ok: true, id: payment.id, href: `/payments/${payment.id}` };
    });
    if (result.ok) revalidatePath("/", "layout");
    return result;
  } catch (e) {
    if (e instanceof Refused) return e.result;
    throw e;
  }
}

export async function createGroupReceipt(_: ActionResult, form: FormData): Promise<ActionResult> {
  return refuseOnClosedDay(() => createGroupReceiptUnguarded(_, form));
}

// ── Instalments by date (#23): "Generate advance bills" ──

const advanceSchema = z.object({
  customerId: z.string().default(""),
  billGroupId: z.string().default(""),
  to: z.iso.date("Pick the To date"),
});

/**
 * Raises the advance instalments up to `to` as Due bills (BL- numbers), without taking payment. Same limits as paying
 * in advance: 12 months ahead, never past the product's bill rule or the term, active policies only. Each policy is
 * locked and re-read, and a bill date can exist once per policy, so a double click can't raise a month twice.
 */
export async function generateAdvanceBills(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Receipt.Create");
  const parsed = advanceSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);
  const { customerId, billGroupId } = parsed.data;
  const to = new Date(`${parsed.data.to}T00:00:00Z`);
  const today = istToday();

  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const scope = billGroupId
      ? { billGroup: { billGroupId, billGroup: { tenantId: user.tenantId } } }
      : customerId ? { customerId } : null;
    if (!scope) return { ok: false, error: "Pick a customer or a bill group" };
    const policies = await tx.policy.findMany({
      where: { tenantId: user.tenantId, status: "Active", ...scope },
      include: { product: { select: { invoiceRule: true } }, customer: { select: { ownerId: true } } },
      orderBy: { id: "asc" },
    });
    let raised = 0;
    for (const policy of policies) {
      if (!canWorkOn(user, policy.customer.ownerId)) return { ok: false, error: `${policy.policyNumber} belongs to another user's customer` };
      await lockPolicyDues(tx, policy.id);
      const stored = await tx.renewalItem.findMany({ where: { policyId: policy.id } });
      const advance = payableDues({ ...policy, billUntil: billEnd(policy, policy.product?.invoiceRule) }, stored, today).filter((d) => !d.itemId && d.dueDate <= to);
      if (!advance.length) continue;
      const created = await tx.renewalItem.createMany({
        data: advance.map((d) => ({ tenantId: user.tenantId, policyId: policy.id, dueDate: d.dueDate, premiumAmount: d.amount, status: "Due" as const })),
        skipDuplicates: true,
      });
      raised += created.count;
    }
    if (raised) {
      await audit(tx, user, {
        entity: billGroupId ? "BillGroup" : "Customer", entityId: billGroupId || customerId, action: "AdvanceBills",
        summary: `${raised} advance bill(s) raised up to ${fmtDate(to)}`,
      });
    }
    return { ok: true, message: raised ? `${raised} advance bill(s) raised up to ${fmtDate(to)}` : "No advance bills to raise in this range" };
  });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
