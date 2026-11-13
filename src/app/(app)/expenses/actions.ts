"use server";

import { audit } from "@/lib/audit";
import { Prisma, type Expense } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { cashAndBank } from "@/lib/accounts";
import { resolveDropdown } from "@/lib/dropdowns";
import { checkDenominations, denominationsField } from "@/lib/payment-options";
import { refuseOnClosedDay } from "@/lib/action-guard";
import { billProblem, saveBill } from "@/lib/bill-storage";
import { balanceAt, isDayClosed, lockDay, reverseSource } from "@/lib/daybook";
import { fmtDate, istToday } from "@/lib/dates";
import { db, type Tx } from "@/lib/db";
import { approvalLevelFor, canApprove, canCancel } from "@/lib/expenses";
import { D, fmtINR } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import { postExpensePayment } from "@/lib/posting";
import { authorize, type SessionUser } from "@/lib/session";

const expenseSchema = z
  .object({
    expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date"),
    category: z.string().trim().min(1, "Pick a purpose"),
    categoryOther: z.string().default(""), // typed when the purpose is "Other"
    description: z.string().trim().min(2, "Describe the expense").max(200),
    notes: z.string().default("").transform((s) => s.trim()).pipe(z.string().min(3, "Enter notes – required for every expense").max(500)),
    amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount").refine((v) => Number(v) > 0, "Amount must be more than 0"),
    vendor: z.string().trim().min(2, "Enter the vendor"),
    billNo: z.string().trim().max(40).default("").transform((v) => v.toUpperCase()), // optional (#42)
    paidBy: z.enum(["Company", "Employee", "Owner"]),
    paidByName: z.string().trim().max(80).default(""), // absent when the company paid
    mode: z.enum(["Cash", "UPI", "Bank", "Card", "Cheque"]),
    reference: z.string().trim().max(60).default(""), // transaction ID, or cheque no. for a cheque; not for cash (#42)
    fromAccount: z.string().default(""), // company account id; absent when an employee or the owner paid
    denominations: denominationsField, // when paid from office cash
  })
  .refine((v) => v.paidBy !== "Company" || v.fromAccount, { message: "Pick the company account", path: ["fromAccount"] })
  .refine((v) => v.paidBy !== "Employee" || v.paidByName, { message: "Enter the employee's name", path: ["paidByName"] })
  .superRefine((v, ctx) => {
    if (v.mode !== "Cash" && v.reference.length < 2) {
      ctx.addIssue({ code: "custom", message: `Enter the ${v.mode === "Cheque" ? "cheque number" : "transaction ID"}`, path: ["reference"] });
    }
  });

/** Thrown inside a transaction so the expense change is rolled back with the payment. */
class PaymentBlocked extends Error {}

const fail = (error: string, field?: string): ActionResult => ({ ok: false, error, fieldErrors: field ? { [field]: error } : undefined });

/** Company money leaves now: check the balance, then post to the Day Book (dated today, the payment day). */
async function payNow(tx: Tx, e: Expense, user: SessionUser, accountId: string, vendorName: string, mode?: Expense["mode"], denominations?: Prisma.InputJsonValue) {
  const today = istToday();
  const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
  const balance = await balanceAt(tx, accountId, today);
  if (balance.lt(e.amount)) return `${account.name} has only ${fmtINR(balance)} for this ${fmtINR(e.amount)} payment`;
  await postExpensePayment(tx, e, { vendorName, date: today, createdById: user.id, mode, denominations });
  await audit(tx, user, { entity: "Expense", entityId: e.id, action: "Pay", summary: `${e.expenseNo} paid ${fmtINR(e.amount)} to ${vendorName} from ${account.name}` });
  return null;
}

async function createExpenseUnguarded(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Expense.Create");
  const parsed = expenseSchema.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return fail(i.message, String(i.path[0]));
  }
  const v = parsed.data;
  const bill = form.get("bill");
  const billFile = bill instanceof File && bill.size > 0 ? bill : null;
  const problem = billProblem(billFile);
  if (problem) return fail(problem, "bill");
  const expenseDate = new Date(`${v.expenseDate}T00:00:00Z`);
  if (expenseDate > istToday()) return fail("The expense date can't be in the future", "expenseDate");

  const level = approvalLevelFor(v.amount, user.role);
  let created: Expense | null = null;
  try {
    const result = await db.$transaction(async (tx): Promise<ActionResult> => {
      const vendor =
        (await tx.vendor.findFirst({ where: { tenantId: user.tenantId, name: { equals: v.vendor, mode: "insensitive" } } })) ??
        (await tx.vendor.create({ data: { tenantId: user.tenantId, name: v.vendor } }));
      // One bill cannot be entered twice (e.g. split to dodge approval) – checked only when a bill number is given (#42).
      const dup = v.billNo ? await tx.expense.findFirst({ where: { tenantId: user.tenantId, vendorId: vendor.id, billNo: v.billNo } }) : null;
      if (dup) {
        return {
          ...fail(`Bill ${v.billNo} from ${vendor.name} is already entered (${dup.expenseNo}, ${fmtDate(dup.expenseDate)}, ${fmtINR(dup.amount)}). The same bill number cannot be entered twice.`, "billNo"),
          duplicateBill: { expenseNo: dup.expenseNo, date: fmtDate(dup.expenseDate), amount: fmtINR(dup.amount), vendor: vendor.name, billNo: v.billNo },
        };
      }
      const company = v.paidBy === "Company";
      // Settings → Bank accounts and wallets: active bank accounts or office cash.
      const from = company ? await tx.account.findFirst({ where: { id: v.fromAccount, tenantId: user.tenantId, type: { in: ["Cash", "Bank"] }, active: true } }) : null;
      if (company && !from) return fail("Pick an active company account", "fromAccount");
      // Paid out of office cash: count the notes (stored now, put on the Day Book line when the money moves).
      const cash = from?.type === "Cash" ? checkDenominations(v.denominations, new D(v.amount)) : null;
      if (cash && "error" in cash) return fail(cash.error, "denominations");
      // Purpose from Settings → Dropdown values; "Other" adds the typed one to the list – last check, so a refused
      // expense never leaves a new value behind (returning from the transaction does not roll it back).
      const purpose = await resolveDropdown(tx, user, "expensePurpose", v.category, v.categoryOther);
      if ("error" in purpose) return fail(purpose.error, "category");
      const e = await tx.expense.create({
        data: {
          tenantId: user.tenantId, expenseNo: await nextNumber(tx, user.tenantId, "expense"), expenseDate,
          category: purpose.value, description: v.description, notes: v.notes, amount: new D(v.amount), vendorId: vendor.id, billNo: v.billNo || null,
          paidBy: v.paidBy, paidByName: v.paidBy === "Owner" ? "Owner" : v.paidBy === "Employee" ? v.paidByName : null, mode: v.mode,
          reference: v.mode === "Cash" ? null : v.reference,
          fromAccountId: from?.id ?? null,
          denominations: cash?.ok ?? undefined,
          repaymentStatus: company ? "NotNeeded" : "ToBeRepaid",
          status: level === "None" ? "Saved" : "Waiting", approvalLevel: level, createdById: user.id,
        },
      });
      await audit(tx, user, { entity: "Expense", entityId: e.id, action: "Create", summary: `${e.expenseNo} · ${e.category} · ${vendor.name}${e.billNo ? ` bill ${e.billNo}` : ""} · ${v.amount}` });
      if (company && e.status === "Saved") {
        const err = await payNow(tx, e, user, e.fromAccountId!, vendor.name);
        if (err) throw new PaymentBlocked(err);
      }
      created = e;
      return { ok: true, id: e.id };
    });
    const saved = created as Expense | null;
    if (saved && billFile) {
      await db.expense.update({ where: { id: saved.id }, data: { billPhotoPath: await saveBill(billFile, saved.id) } });
    }
    revalidatePath("/expenses");
    return result;
  } catch (e) {
    if (e instanceof PaymentBlocked) return fail(e.message, "fromAccount");
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fail(`Bill ${v.billNo} was just entered by someone else`, "billNo");
    throw e;
  }
}


async function loadForDecision(tx: Tx, user: SessionUser, id: string) {
  return tx.expense.findFirst({ where: { id, tenantId: user.tenantId }, include: { vendor: true } });
}

export async function approveExpense(expenseId: string): Promise<ActionResult> {
  const user = await authorize("Expense.Approve");
  try {
    const result = await db.$transaction(async (tx): Promise<ActionResult> => {
      const e = await loadForDecision(tx, user, expenseId);
      if (!e) return fail("Expense not found");
      if (!canApprove(user, e)) {
        return fail(e.createdById === user.id ? "You can't approve your own expense; it goes to the Super Admin" : "This expense needs a different approver");
      }
      const updated = await tx.expense.update({ where: { id: e.id }, data: { status: "Approved", approvedById: user.id, approvedAt: new Date() } });
      await audit(tx, user, { entity: "Expense", entityId: e.id, action: "Approve", summary: `${e.expenseNo} approved` });
      if (e.paidBy !== "Company") return { ok: true };
      // Approving is a decision; paying moves money. If today's Day Book is closed, approve now
      // and leave the payment for "Mark paid" on the next open day. The shared lock stops a
      // close from landing between this check and the posting.
      const today = istToday();
      await lockDay(tx, user.tenantId, today, "shared");
      if (await isDayClosed(tx, user.tenantId, today)) {
        return { ok: true, message: "Approved. Today's Day Book is closed, so mark it paid on the next open day." };
      }
      const err = await payNow(tx, updated, user, e.fromAccountId!, e.vendor.name);
      if (err) throw new PaymentBlocked(err);
      return { ok: true };
    });
    revalidatePath("/", "layout");
    return result;
  } catch (e) {
    if (e instanceof PaymentBlocked) return fail(e.message);
    throw e;
  }
}

const reasonSchema = z.object({ expenseId: z.string(), reason: z.string().trim().min(3, "Enter the reason") });

export async function rejectExpense(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Expense.Approve");
  const parsed = reasonSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { expenseId, reason } = parsed.data;
  const e = await db.expense.findFirst({ where: { id: expenseId, tenantId: user.tenantId } });
  if (!e) return fail("Expense not found");
  if (!canApprove(user, e)) return fail("This expense needs a different approver");
  await db.$transaction(async (tx) => {
    await tx.expense.update({ where: { id: e.id }, data: { status: "Rejected", rejectReason: reason, approvedById: user.id, approvedAt: new Date() } });
    await audit(tx, user, { entity: "Expense", entityId: e.id, action: "Reject", summary: `${e.expenseNo} rejected`, reason });
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Users cancel their own, Admin / Super Admin any. Money that already moved is reversed today. */
async function cancelExpenseUnguarded(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Expense.Create");
  const parsed = reasonSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { expenseId, reason } = parsed.data;
  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const e = await tx.expense.findFirst({ where: { id: expenseId, tenantId: user.tenantId } });
    if (!e) return fail("Expense not found");
    if (!canCancel(user, e)) return fail("You can cancel only your own expenses");
    await tx.expense.update({ where: { id: e.id }, data: { status: "Cancelled", cancelReason: reason } });
    await audit(tx, user, { entity: "Expense", entityId: e.id, action: "Cancel", summary: `${e.expenseNo} cancelled`, reason });
    await reverseSource(tx, { tenantId: user.tenantId, sourceType: "Expense", sourceId: e.id, entryDate: istToday(), createdById: user.id, reason });
    return { ok: true };
  });
  revalidatePath("/", "layout");
  return result;
}

const repaySchema = z.object({ expenseId: z.string(), from: z.enum(["cash", "bank"]), denominations: denominationsField });

/** Pay back an employee or the owner who spent their own money; this is when company money moves. */
async function repayExpenseUnguarded(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Expense.Approve");
  const parsed = repaySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  try {
    const result = await db.$transaction(async (tx): Promise<ActionResult> => {
      const e = await loadForDecision(tx, user, parsed.data.expenseId);
      if (!e) return fail("Expense not found");
      if (e.paidBy === "Company" || e.repaymentStatus !== "ToBeRepaid") return fail("Nothing to repay on this expense");
      if (e.status !== "Saved" && e.status !== "Approved") return fail("Approve the expense before repaying it");
      const accounts = await cashAndBank(tx, user.tenantId);
      const account = parsed.data.from === "cash" ? accounts.cash : accounts.bank;
      const cash = parsed.data.from === "cash" ? checkDenominations(parsed.data.denominations, e.amount) : null;
      if (cash && "error" in cash) return fail(cash.error, "denominations");
      const updated = await tx.expense.update({
        where: { id: e.id },
        data: { repaymentStatus: "Repaid", repaidOn: istToday(), repaidFromAccountId: account.id },
      });
      await audit(tx, user, { entity: "Expense", entityId: e.id, action: "Repay", summary: `${e.expenseNo} repaid to ${e.paidByName ?? e.paidBy} from ${account.name}` });
      const err = await payNow(tx, updated, user, account.id, e.vendor.name, parsed.data.from === "cash" ? "Cash" : "Bank", cash?.ok);
      if (err) throw new PaymentBlocked(err);
      return { ok: true };
    });
    revalidatePath("/", "layout");
    return result;
  } catch (e) {
    if (e instanceof PaymentBlocked) return fail(e.message);
    throw e;
  }
}

/** Pay an approved company expense that wasn't paid at approval (the Day Book was closed then). */
export async function markExpensePaid(expenseId: string): Promise<ActionResult> {
  const user = await authorize("Expense.Approve");
  return refuseOnClosedDay(async () => {
    try {
      const result = await db.$transaction(async (tx): Promise<ActionResult> => {
        const e = await loadForDecision(tx, user, expenseId);
        if (!e) return fail("Expense not found");
        if (e.status !== "Approved" || e.paidBy !== "Company") return fail("Only approved company-paid expenses are paid here");
        if (await isPaid(tx, e.id)) return fail("Already paid");
        const err = await payNow(tx, e, user, e.fromAccountId!, e.vendor.name);
        if (err) throw new PaymentBlocked(err);
        return { ok: true };
      });
      revalidatePath("/", "layout");
      return result;
    } catch (e) {
      if (e instanceof PaymentBlocked) return fail(e.message);
      throw e;
    }
  });
}

/** Paid = company money left for it: a live (not reversed) Day Book entry exists. */
async function isPaid(tx: Tx, expenseId: string) {
  const live = await tx.dayBookEntry.count({ where: { sourceType: "Expense", sourceId: expenseId, reversalOfId: null, reversedBy: { is: null } } });
  return live > 0;
}

export async function createExpense(_: ActionResult, form: FormData): Promise<ActionResult> {
  return refuseOnClosedDay(() => createExpenseUnguarded(_, form));
}

export async function cancelExpense(_: ActionResult, form: FormData): Promise<ActionResult> {
  return refuseOnClosedDay(() => cancelExpenseUnguarded(_, form));
}

export async function repayExpense(_: ActionResult, form: FormData): Promise<ActionResult> {
  return refuseOnClosedDay(() => repayExpenseUnguarded(_, form));
}
