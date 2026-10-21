"use server";

import { randomUUID } from "node:crypto";
import { checkDenominations, denominationsField } from "@/lib/payment-options";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { cashAndBank } from "@/lib/accounts";
import { audit } from "@/lib/audit";
import { refuseOnClosedDay } from "@/lib/action-guard";
import { accountDay, assertDayOpen, balanceAt, earliestOpenDayBefore, lockDay, post } from "@/lib/daybook";
import { CASH_SOURCES, UPI_ADJUSTMENT_REASONS } from "@/lib/daybook-labels";
import { fmtDate, istToday } from "@/lib/dates";
import { db, type Tx } from "@/lib/db";
import { D, fmtINR, sum, ZERO } from "@/lib/money";
import { canActOn } from "@/lib/leads";
import { hasPermission, seesAll } from "@/lib/permissions";
import { postPoDeposit } from "@/lib/posting";
import { authorize } from "@/lib/session";

const fail = (error: string): ActionResult => ({ ok: false, error });
const money = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount");
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((s) => new Date(`${s}T00:00:00Z`));

/** Day Book writes are for today or an earlier day that is still open. */
function checkDate(date: Date) {
  return date > istToday() ? "The Day Book can't be written for a future date" : null;
}

/** Runs a Day Book write; a closed day surfaces as a friendly error instead of a crash. */
async function guarded(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  const r = await refuseOnClosedDay(fn);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

const atmSchema = z.object({ date: isoDay, amount: money.refine((v) => Number(v) > 0, "Amount must be more than 0"), notes: z.string().trim().max(200) });

/** ATM / bank withdrawal for UPI-paid RD: bank out, cash in. A transfer, never an expense. */
export async function recordAtmWithdrawal(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("DayBook.Create");
  const parsed = atmSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { date, amount, notes } = parsed.data;
  if (checkDate(date)) return fail(checkDate(date)!);
  return guarded(() =>
    db.$transaction(async (tx) => {
      const { cash, bank } = await cashAndBank(tx, user.tenantId);
      const a = new D(amount);
      const balance = await balanceAt(tx, bank.id, date);
      if (balance.lt(a)) return fail(`${bank.name} has only ${fmtINR(balance)}`);
      const particulars = `ATM withdrawal${notes ? ` · ${notes}` : ""}`;
      await post(tx, {
        tenantId: user.tenantId, entryDate: date, sourceType: "Contra", sourceId: randomUUID(), createdById: user.id,
        lines: [
          { key: "out", accountId: bank.id, direction: "Out", amount: a, entryType: "Withdrawal", mode: "Bank", particulars, notes },
          { key: "in", accountId: cash.id, direction: "In", amount: a, entryType: "Withdrawal", mode: "Cash", particulars, notes },
        ],
      });
      return { ok: true };
    }),
  );
}

const depositSchema = z.object({
  date: isoDay,
  receiptIds: z.string().transform((s) => s.split(",").filter(Boolean)).pipe(z.array(z.string()).min(1, "Tick the receipts being deposited")),
  poReceiptNo: z.string().trim().min(3, "Enter the post office receipt number"),
  amount: money,
  amountReason: z.string().trim().max(200).default(""),
  upiReason: z.union([z.literal(""), z.enum(UPI_ADJUSTMENT_REASONS)]).default(""),
  note: z.string().trim().max(200).default(""),
  denominations: denominationsField, // the cash handed over
});

/**
 * Deposit to Post Office: the ticked Collected RD receipts go under one PO receipt number.
 * Cash goes down by the amount; receipts and their commission move to Deposited.
 */
export async function depositToPostOffice(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("DayBook.Create");
  const parsed = depositSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;
  if (checkDate(v.date)) return fail(checkDate(v.date)!);
  const amount = new D(v.amount);

  return guarded(() =>
    db.$transaction(async (tx): Promise<ActionResult> => {
      await assertDayOpen(tx, user.tenantId, v.date);
      const receipts = await tx.receipt.findMany({
        where: { id: { in: v.receiptIds }, tenantId: user.tenantId, status: "Saved", rdStatus: "Collected", ownerPaid: false, receiptDate: { lte: v.date } },
      });
      if (receipts.length !== v.receiptIds.length) return fail("Some receipts are no longer waiting for deposit; reload and try again");
      const ticked = sum(receipts.map((r) => r.amount));
      if (!ticked.equals(amount)) {
        if (!hasPermission(user.role, "DayBook.Close")) return fail(`Ticked receipts total ${fmtINR(ticked)} but ${fmtINR(amount)} was deposited; an Admin must record the reason`);
        if (!v.amountReason) return fail(`Ticked ${fmtINR(ticked)} ≠ deposited ${fmtINR(amount)}: enter the reason`);
      }
      // UPI-paid instalments are deposited in cash drawn from the bank; any gap needs a reason.
      const upiPortion = receipts.filter((r) => r.mode !== "Cash").reduce((s, r) => s.plus(r.amount), ZERO);
      const { cash } = await cashAndBank(tx, user.tenantId);
      const atm = await tx.dayBookEntry.aggregate({
        where: { tenantId: user.tenantId, entryDate: v.date, accountId: cash.id, entryType: "Withdrawal" },
        _sum: { amount: true },
      });
      const atmTotal = atm._sum.amount ?? ZERO;
      if (!upiPortion.equals(atmTotal) && !v.upiReason) {
        return fail(`UPI-paid receipts ${fmtINR(upiPortion)} vs ATM withdrawn today ${fmtINR(atmTotal)}: pick a reason for the difference`);
      }
      const cashNow = await balanceAt(tx, cash.id, v.date);
      if (cashNow.lt(amount)) return fail(`Cash in hand is only ${fmtINR(cashNow)}`);
      const notes = checkDenominations(v.denominations, amount);
      if ("error" in notes) return fail(notes.error);

      const reasons = [v.upiReason && `UPI vs ATM: ${v.upiReason}`, v.amountReason && `Amount: ${v.amountReason}`].filter(Boolean).join("; ");
      const deposit = await tx.poDeposit.create({
        data: {
          tenantId: user.tenantId, poReceiptNo: v.poReceiptNo, depositDate: v.date, amount, receiptsTotal: ticked, upiPortion,
          adjustmentReason: reasons || null, adjustmentNote: v.note || null, createdById: user.id,
          lines: { create: receipts.map((r) => ({ receiptId: r.id, policyId: r.policyId!, amount: r.amount })) },
        },
      });
      await tx.receipt.updateMany({ where: { id: { in: receipts.map((r) => r.id) } }, data: { rdStatus: "Deposited" } });
      await tx.commission.updateMany({ where: { receiptId: { in: receipts.map((r) => r.id) } }, data: { poDepositId: deposit.id } });
      await postPoDeposit(tx, deposit, { accountId: cash.id, mode: "Cash", receiptCount: receipts.length, denominations: notes.ok });
      return { ok: true };
    }),
  );
}

const oneDepositSchema = z.object({
  receiptId: z.string().min(1),
  paidOn: isoDay,
  accountId: z.string().min(1, "Pick the account it was paid from"),
  reference: z.string().trim().min(2, "Enter the post office receipt / transaction ID").max(60),
  denominations: denominationsField, // when paid from office cash
});

/**
 * One RD receipt deposited from its own page (owner's choice): a one-line PO deposit, so the Day Book,
 * commission and cancel rules work as for the Day Book deposit. Skips the UPI vs ATM check, so that is noted.
 */
export async function depositOneRdReceipt(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("DayBook.Create");
  const parsed = oneDepositSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;
  if (checkDate(v.paidOn)) return fail(checkDate(v.paidOn)!);

  return guarded(() =>
    db.$transaction(async (tx): Promise<ActionResult> => {
      await assertDayOpen(tx, user.tenantId, v.paidOn);
      const r = await tx.receipt.findFirst({
        where: { id: v.receiptId, tenantId: user.tenantId, status: "Saved", rdStatus: "Collected", ownerPaid: false },
        include: { policy: { select: { ownerId: true } } },
      });
      if (!r) return fail("This receipt is no longer waiting for deposit; reload and try again");
      if (!seesAll(user.role) && r.createdById !== user.id && !canActOn(user, r.policy!.ownerId)) return fail("This receipt belongs to another user");
      if (r.receiptDate > v.paidOn) return fail(`${r.receiptNo} was collected on ${fmtDate(r.receiptDate)}, after the deposit date`);
      const account = await tx.account.findFirst({ where: { id: v.accountId, tenantId: user.tenantId, type: { in: ["Cash", "Bank"] }, active: true } });
      if (!account) return fail("Pick the cash or bank account it was paid from");
      const balance = await balanceAt(tx, account.id, v.paidOn);
      if (balance.lt(r.amount)) return fail(`${account.name} has only ${fmtINR(balance)}`);
      const mode = account.type === "Cash" ? "Cash" as const : "Bank" as const;
      const notes = mode === "Cash" ? checkDenominations(v.denominations, r.amount) : null;
      if (notes && "error" in notes) return fail(notes.error);

      const deposit = await tx.poDeposit.create({
        data: {
          tenantId: user.tenantId, poReceiptNo: v.reference, depositDate: v.paidOn, amount: r.amount, receiptsTotal: r.amount,
          upiPortion: r.mode === "Cash" ? ZERO : r.amount, adjustmentReason: `Deposited from receipt ${r.receiptNo} (paid from ${account.name}; no UPI vs ATM check)`,
          createdById: user.id, lines: { create: [{ receiptId: r.id, policyId: r.policyId!, amount: r.amount }] },
        },
      });
      const updated = await tx.receipt.updateMany({ where: { id: r.id, rdStatus: "Collected" }, data: { rdStatus: "Deposited" } });
      if (updated.count !== 1) throw new Error("Receipt changed while saving; try again");
      await tx.commission.updateMany({ where: { receiptId: r.id }, data: { poDepositId: deposit.id } });
      await postPoDeposit(tx, deposit, { accountId: account.id, mode, receiptCount: 1, denominations: notes?.ok });
      return { ok: true };
    }),
  );
}

const counted = z.union([z.literal(""), money]).default("");
const countSchema = z.object({ date: isoDay, PostOffice: counted, GRM: counted, ESevai: counted, PAN: counted, Others: counted });

/** Cash counted by source; saving it shows whether the cash tallies. */
export async function saveCashCount(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("DayBook.Create");
  const parsed = countSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Enter amounts in rupees");
  const v = parsed.data;
  if (checkDate(v.date)) return fail(checkDate(v.date)!);
  const bySource = Object.fromEntries(CASH_SOURCES.map((s) => [s, new D(v[s] || 0).toFixed(2)]));
  const physical = sum(Object.values(bySource));

  return guarded(() =>
    db.$transaction(async (tx) => {
      await assertDayOpen(tx, user.tenantId, v.date);
      const { cash } = await cashAndBank(tx, user.tenantId);
      const day = (await accountDay(tx, user.tenantId, v.date)).find((d) => d.accountId === cash.id)!;
      const values = {
        opening: day.opening, totalIn: day.totalIn, totalOut: day.totalOut, computed: day.closing,
        physical, difference: physical.minus(day.closing), cashBySource: bySource,
      };
      await tx.dayClose.upsert({
        where: { tenantId_accountId_date: { tenantId: user.tenantId, accountId: cash.id, date: v.date } },
        create: { tenantId: user.tenantId, accountId: cash.id, date: v.date, ...values },
        update: values,
      });
      return { ok: true };
    }),
  );
}

const verifySchema = z.object({ date: isoDay, verifiedById: z.string().min(1, "Pick who verified the cash") });

export async function saveVerification(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("DayBook.Verify");
  const parsed = verifySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { date, verifiedById } = parsed.data;
  return guarded(() =>
    db.$transaction(async (tx) => {
      await assertDayOpen(tx, user.tenantId, date);
      const verifier = await tx.user.findFirst({ where: { id: verifiedById, tenantId: user.tenantId, role: { in: ["Admin", "SuperAdmin"] } } });
      if (!verifier) return fail("Verifier must be an Admin or Super Admin");
      const { cash } = await cashAndBank(tx, user.tenantId);
      const row = await tx.dayClose.findUnique({ where: { tenantId_accountId_date: { tenantId: user.tenantId, accountId: cash.id, date } } });
      if (!row?.physical) return fail("Save the cash count first");
      await tx.dayClose.update({ where: { id: row.id }, data: { verifiedById, verifiedAt: new Date() } });
      return { ok: true };
    }),
  );
}

/**
 * Close the Day Book: only when every earlier day is closed, the cash tallies right now,
 * and the count was verified. Every account is locked for the date.
 */
export async function closeDayBook(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("DayBook.Close");
  const parsed = z.object({ date: isoDay }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail("Invalid date");
  const { date } = parsed.data;
  if (checkDate(date)) return fail(checkDate(date)!);
  return guarded(() =>
    db.$transaction(async (tx: Tx): Promise<ActionResult> => {
      await lockDay(tx, user.tenantId, date, "exclusive"); // no posting while closing
      const { cash } = await cashAndBank(tx, user.tenantId);
      const rows = await tx.dayClose.findMany({ where: { tenantId: user.tenantId, date } });
      if (rows.some((r) => r.status === "Closed")) return fail("This day is already closed");
      const earlier = await earliestOpenDayBefore(tx, user.tenantId, date);
      if (earlier) return fail(`Close ${fmtDate(earlier)} first; earlier days must be closed before this one`);
      const cashRow = rows.find((r) => r.accountId === cash.id);
      if (!cashRow?.physical) return fail("Count the cash first");
      const days = await accountDay(tx, user.tenantId, date);
      const cashDay = days.find((d) => d.accountId === cash.id)!;
      const diff = cashRow.physical.minus(cashDay.closing);
      if (!diff.isZero()) return fail(`NOT TALLIED: counted ${fmtINR(cashRow.physical)} vs computed ${fmtINR(cashDay.closing)} (difference ${fmtINR(diff)}). Recount or record the missing entry.`);
      if (!cashRow.verifiedById) return fail("Save the verification before closing");

      const closedAt = new Date();
      for (const d of days) {
        const values = {
          opening: d.opening, totalIn: d.totalIn, totalOut: d.totalOut, computed: d.closing,
          physical: d.accountId === cash.id ? cashRow.physical : d.closing,
          difference: ZERO, status: "Closed" as const, closedById: user.id, closedAt,
        };
        await tx.dayClose.upsert({
          where: { tenantId_accountId_date: { tenantId: user.tenantId, accountId: d.accountId, date } },
          create: { tenantId: user.tenantId, accountId: d.accountId, date, ...values, verifiedById: cashRow.verifiedById, verifiedAt: cashRow.verifiedAt },
          update: values,
        });
      }
      return { ok: true };
    }),
  );
}

const otherIncomeSchema = z.object({
  date: isoDay,
  amount: money.refine((v) => Number(v) > 0, "Amount must be more than 0"),
  accountId: z.string().min(1, "Pick where the money came in"),
  reason: z.string().trim().min(3, "Enter what this income is for (e.g. SBI interest, LIC incentive)").max(200),
});

/**
 * Other income (interest, incentives, …): money in to cash or bank that is business income, so it counts
 * in Profit and Loss. Admin and Super Admin only; corrections are reversals like every Day Book entry.
 */
export async function recordOtherIncome(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("DayBook.Close");
  const parsed = otherIncomeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { date, amount, accountId, reason } = parsed.data;
  if (checkDate(date)) return fail(checkDate(date)!);
  return guarded(() =>
    db.$transaction(async (tx) => {
      const account = await tx.account.findFirst({ where: { id: accountId, tenantId: user.tenantId, type: { in: ["Cash", "Bank"] }, active: true } });
      if (!account) return fail("Pick the cash or bank account the money came into");
      const sourceId = randomUUID();
      await post(tx, {
        tenantId: user.tenantId, entryDate: date, sourceType: "Manual", sourceId, createdById: user.id,
        lines: [{
          key: "in", accountId: account.id, direction: "In", amount, entryType: "OtherIncome", mode: account.type === "Cash" ? "Cash" : "Bank",
          particulars: `Other income · ${reason}`, productCategory: "Other income", notes: reason,
        }],
      });
      await audit(tx, user, {
        entity: "DayBook", entityId: sourceId, action: "Other income", summary: `${fmtINR(new D(amount))} into ${account.name} on ${fmtDate(date)}`,
        after: { amount: fmtINR(new D(amount)), account: account.name, date: fmtDate(date) }, reason,
      });
      return { ok: true };
    }),
  );
}
