"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { refuseOnClosedDay } from "@/lib/action-guard";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { accountLabel, receivingAccount } from "@/lib/accounts";
import { audit } from "@/lib/audit";
import { balanceAt } from "@/lib/daybook";
import { istNowHHMM, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { D, fmtINR } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import { checkDenominations, denominationsField } from "@/lib/payment-options";
import { postServiceTransaction, postWalletRecharge } from "@/lib/posting";
import { closedDayError, dateOrToday, pastOrTodayField } from "@/lib/receipt-lines";
import { authorize } from "@/lib/session";

const money = (msg: string) => z.string().trim().regex(/^\d+(\.\d{1,2})?$/, msg).refine((v) => Number(v) > 0, "Amount must be more than 0");

const entrySchema = z
  .object({
    txnDate: pastOrTodayField, // "" = today; earlier days allowed until the last closed Day Book day
    txnTime: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick the time")]).default(""), // "" = now
    serviceCode: z.enum(["EB", "PAN", "CERT", "OTHER"], "Pick the service"),
    serviceName: z.string().trim().max(60).default(""), // Other: the service typed
    providerRef: z.string().trim().max(40).default(""), // service no. / application no.
    customerMobile: z.union([z.literal(""), z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number")]).default(""),
    customerName: z.string().trim().max(80).default(""),
    gender: z.union([z.literal(""), z.enum(["Female", "Male", "Other"])]).default(""),
    paidAmount: money("Enter the amount paid / deducted"),
    paidVia: z.enum(["Wallet", "GPay", "NetBanking"]),
    paidFromAccountId: z.string().min(1, "Pick where it was paid from"),
    providerTxnNo: z.string().trim().max(40).default(""), // optional (owner, 2 Nov 2026)
    collected: money("Enter the amount collected from the customer"),
    mode: z.enum(["Cash", "UPI"]),
    intoAccountId: z.string().trim().default(""), // UPI: the bank account it came into
    // No UTR or notes on new entries (owner, 12 Nov 2026); older entries keep theirs.
    denominations: denominationsField, // cash notes / coins collected
  })
  .refine((v) => v.serviceCode !== "OTHER" || v.serviceName.length >= 2, { message: "Type the service name", path: ["serviceName"] })
  .refine((v) => v.serviceCode !== "EB" || v.providerRef, { message: "Enter the EB consumer / service no.", path: ["providerRef"] });

/** Wallet or bank too low: refuse the entry and tell the Admins (mocked WhatsApp). */
async function alertLowBalance(tenantId: string, accountName: string, balance: string, needed: string, userId: string) {
  const admins = await db.user.findMany({ where: { tenantId, role: { in: ["Admin", "SuperAdmin"] }, active: true } });
  await db.messageLog.createMany({
    data: admins.map((a) => ({
      tenantId, channel: "WhatsApp" as const, to: a.name, template: "low_wallet_balance",
      body: `${accountName} is low: balance ${balance}, needed ${needed}. Please recharge.`, relatedType: "Account", createdById: userId,
    })),
  });
}

/**
 * E-Sevai / CSC entry (#7). Staff type what was paid to the provider and what the customer paid (the rate table only
 * prefills it); service charge = collected − paid, counted in P&L. Paid from any active wallet, or straight from a bank
 * account (GPay / net banking) where the service allows it. A mobile that belongs to a customer links the entry to them.
 */
async function createServiceEntryUnguarded(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Service.Record");
  const parsed = entrySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: i.message, fieldErrors: { [String(i.path[0])]: i.message } };
  }
  const v = parsed.data;
  const date = dateOrToday(v.txnDate);
  const now = istNowHHMM();
  const time = v.txnTime || now;
  if (date.getTime() === istToday().getTime() && time > now) return { ok: false, error: "Time can't be later than now", fieldErrors: { txnTime: "Future" } };
  const paid = new D(v.paidAmount), collected = new D(v.collected);
  if (collected.lt(paid)) return { ok: false, error: "Collected from the customer can't be less than the amount paid", fieldErrors: { collected: "Too low" } };
  const cash = v.mode === "Cash" ? checkDenominations(v.denominations, collected) : null;
  if (cash && "error" in cash) return { ok: false, error: cash.error, fieldErrors: { denominations: cash.error } };
  let lowAlert: Parameters<typeof alertLowBalance> | null = null;

  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const closed = await closedDayError(tx, user.tenantId, date);
    if (closed) return { ok: false, error: closed, fieldErrors: { txnDate: closed } };
    const type = await tx.serviceType.findUniqueOrThrow({ where: { tenantId_code: { tenantId: user.tenantId, code: v.serviceCode } } });
    const direct = v.paidVia !== "Wallet";
    if (direct && !type.allowBankPay) return { ok: false, error: `${type.name} is paid from a wallet`, fieldErrors: { paidFromAccountId: "Wallet only" } };
    const payFrom = await tx.account.findFirst({ where: { id: v.paidFromAccountId, tenantId: user.tenantId, active: true, type: direct ? "Bank" : "Wallet" } });
    if (!payFrom) return { ok: false, error: direct ? "Pick the bank account it was paid from" : "Pick an active wallet", fieldErrors: { paidFromAccountId: "Required" } };
    const into = await receivingAccount(tx, user.tenantId, v.mode, v.intoAccountId);
    if ("error" in into) return { ok: false, error: into.error, fieldErrors: { intoAccountId: into.error } };

    const balance = await balanceAt(tx, payFrom.id, date);
    if (balance.lt(paid)) {
      lowAlert = [user.tenantId, accountLabel(payFrom), fmtINR(balance), fmtINR(paid), user.id];
      return { ok: false, error: `${accountLabel(payFrom)} has only ${fmtINR(balance)}; ${fmtINR(paid)} is needed. Recharge first — Admin has been alerted.` };
    }
    const customer = v.customerMobile
      ? await tx.customer.findFirst({
          where: { tenantId: user.tenantId, OR: [{ mobile: v.customerMobile }, { mobiles: { some: { number: v.customerMobile } } }] },
          orderBy: { createdAt: "asc" }, select: { id: true, name: true },
        })
      : null;

    const profit = collected.minus(paid);
    const txn = await tx.serviceTransaction.create({
      data: {
        tenantId: user.tenantId, txnNo: await nextNumber(tx, user.tenantId, "service"), txnDate: date, txnTime: time, serviceTypeId: type.id,
        serviceName: v.serviceCode === "OTHER" ? v.serviceName : null,
        customerName: v.customerName || customer?.name || null, customerMobile: v.customerMobile || null, customerId: customer?.id ?? null,
        gender: v.gender || null, paidVia: v.paidVia, paidFromAccountId: payFrom.id, receivedAccountId: into.ok.id,
        baseAmount: paid, walletCost: paid, serviceCharge: profit, customerAmount: collected, profit,
        providerRef: v.providerRef || null, providerTxnNo: v.providerTxnNo || null, paymentMode: v.mode,
        denominations: cash?.ok, createdById: user.id,
      },
    });
    await postServiceTransaction(tx, txn, { serviceCode: type.code, serviceName: txn.serviceName ?? type.name });
    await audit(tx, user, { entity: "ServiceTransaction", entityId: txn.id, action: "Create", summary: `${txn.txnNo} · ${txn.serviceName ?? type.name} · paid ${fmtINR(paid)} from ${accountLabel(payFrom)} · collected ${fmtINR(collected)} (${v.mode})` });
    return { ok: true, id: txn.id, href: `/api/esevai/${txn.id}/pdf` };
  });
  if (lowAlert) await alertLowBalance(...(lowAlert as Parameters<typeof alertLowBalance>));
  if (result.ok) revalidatePath("/esevai");
  return result;
}

const rechargeSchema = z.object({
  walletId: z.string().min(1, "Pick a wallet"),
  amount: money("Enter an amount"),
  bankAccountId: z.string().min(1, "Pick the bank account"),
  reference: z.string().trim().min(2, "Enter the transaction number").max(40),
});

/** Admin / Super Admin (#6): top up a wallet from a company bank account – a bank → wallet transfer, never an expense. */
async function rechargeWalletUnguarded(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Wallet.Recharge");
  const parsed = rechargeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  const today = istToday();
  const amount = new D(v.amount);

  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const wallet = await tx.account.findFirst({ where: { id: v.walletId, tenantId: user.tenantId, type: "Wallet", active: true } });
    if (!wallet) return { ok: false, error: "Wallet not found" };
    const bank = await tx.account.findFirst({ where: { id: v.bankAccountId, tenantId: user.tenantId, type: "Bank", active: true } });
    if (!bank) return { ok: false, error: "Pick an active bank account" };
    const balance = await balanceAt(tx, bank.id, today);
    if (balance.lt(amount)) return { ok: false, error: `${accountLabel(bank)} has only ${fmtINR(balance)}` };
    const id = randomUUID();
    await postWalletRecharge(tx, {
      id, tenantId: user.tenantId, walletId: wallet.id, walletName: wallet.name, fromAccountId: bank.id,
      amount, mode: "Bank", date: today, reference: v.reference, createdById: user.id,
    });
    await audit(tx, user, { entity: "Account", entityId: wallet.id, action: "Recharge", summary: `${wallet.name} recharged ${fmtINR(amount)} from ${accountLabel(bank)} · Txn ${v.reference}` });
    return { ok: true };
  });
  if (result.ok) revalidatePath("/esevai");
  return result;
}

export async function createServiceEntry(_: ActionResult, form: FormData): Promise<ActionResult> {
  return refuseOnClosedDay(() => createServiceEntryUnguarded(_, form));
}

export async function rechargeWallet(_: ActionResult, form: FormData): Promise<ActionResult> {
  return refuseOnClosedDay(() => rechargeWalletUnguarded(_, form));
}

/** "Matches customer {name} (CIF)" on the entry form: the customer whose main or extra mobile this is. */
export async function findCustomerByMobile(mobile: string): Promise<{ id: string; name: string; cifNo: string } | null> {
  const user = await authorize("Service.Record");
  if (!/^[6-9]\d{9}$/.test(mobile)) return null;
  return db.customer.findFirst({
    where: { tenantId: user.tenantId, OR: [{ mobile }, { mobiles: { some: { number: mobile } } }] },
    orderBy: { createdAt: "asc" }, select: { id: true, name: true, cifNo: true },
  });
}
