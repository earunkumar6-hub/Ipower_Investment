"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { refuseOnClosedDay } from "@/lib/action-guard";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { cashAndBank, receivingAccountId } from "@/lib/accounts";
import { balanceAt } from "@/lib/daybook";
import { istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { priceService, RateNotConfiguredError, ratesInForce } from "@/lib/esevai";
import { D, fmtINR } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";
import { postServiceTransaction, postWalletRecharge } from "@/lib/posting";
import { authorize } from "@/lib/session";

const entrySchema = z
  .object({
    serviceCode: z.enum(["EB", "PAN", "CERT"]),
    baseAmount: z.string().trim(),
    paidFrom: z.enum(["wallet", "bank"]),
    mode: z.enum(["Cash", "UPI"]),
    reference: z.string().trim().max(40), // UTR when the customer paid by UPI
    providerRef: z.string().trim().max(40),
    customerName: z.string().trim().max(80),
    customerMobile: z.union([z.literal(""), z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number")]),
  })
  .refine((v) => v.serviceCode !== "EB" || /^\d+(\.\d{1,2})?$/.test(v.baseAmount), { message: "Enter the EB bill amount", path: ["baseAmount"] })
  .refine((v) => v.serviceCode !== "EB" || v.providerRef, { message: "Enter the EB consumer / reference no.", path: ["providerRef"] });

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

async function createServiceEntryUnguarded(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Service.Record");
  const parsed = entrySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: i.message, fieldErrors: { [String(i.path[0])]: i.message } };
  }
  const v = parsed.data;
  const today = istToday();
  let lowAlert: Parameters<typeof alertLowBalance> | null = null;

  try {
    const result = await db.$transaction(async (tx): Promise<ActionResult> => {
      const type = await tx.serviceType.findUniqueOrThrow({ where: { tenantId_code: { tenantId: user.tenantId, code: v.serviceCode } } });
      if (v.paidFrom === "bank" && !type.allowBankPay) return { ok: false, error: `${type.name} is always paid from its wallet` };
      const price = priceService(type.code, await ratesInForce(tx, type.id, today), v.baseAmount || 0);
      const accounts = await cashAndBank(tx, user.tenantId);
      const payFrom = v.paidFrom === "bank" ? accounts.bank : await tx.account.findUniqueOrThrow({ where: { id: type.walletAccountId } });

      const balance = await balanceAt(tx, payFrom.id, today);
      if (balance.lt(price.walletCost)) {
        lowAlert = [user.tenantId, payFrom.name, fmtINR(balance), fmtINR(price.walletCost), user.id];
        return { ok: false, error: `${payFrom.name} has only ${fmtINR(balance)}; ${fmtINR(price.walletCost)} is needed. Recharge first — Admin has been alerted.` };
      }

      const txn = await tx.serviceTransaction.create({
        data: {
          tenantId: user.tenantId, txnNo: await nextNumber(tx, user.tenantId, "service"), txnDate: today, serviceTypeId: type.id,
          customerName: v.customerName || null, customerMobile: v.customerMobile || null,
          paidFromAccountId: payFrom.id, receivedAccountId: receivingAccountId(v.mode, accounts),
          ...price, providerRef: v.providerRef || null, paymentMode: v.mode, reference: v.reference || null, createdById: user.id,
        },
      });
      await postServiceTransaction(tx, txn, { serviceCode: type.code, serviceName: type.name });
      return { ok: true, id: txn.id };
    });
    if (lowAlert) await alertLowBalance(...(lowAlert as Parameters<typeof alertLowBalance>));
    if (result.ok) revalidatePath("/esevai");
    return result;
  } catch (e) {
    if (e instanceof RateNotConfiguredError) return { ok: false, error: e.message, fieldErrors: { baseAmount: "No rate" } };
    throw e;
  }
}

const rechargeSchema = z.object({
  walletId: z.string().min(1, "Pick a wallet"),
  amount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount").refine((v) => Number(v) > 0, "Amount must be more than 0"),
  from: z.enum(["Bank", "Cash"]),
  reference: z.string().trim().max(40),
});

/** Admin / Super Admin: top up a provider wallet from the bank or cash. */
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
    const accounts = await cashAndBank(tx, user.tenantId);
    const from = v.from === "Bank" ? accounts.bank : accounts.cash;
    const balance = await balanceAt(tx, from.id, today);
    if (balance.lt(amount)) return { ok: false, error: `${from.name} has only ${fmtINR(balance)}` };
    await postWalletRecharge(tx, {
      id: randomUUID(), tenantId: user.tenantId, walletId: wallet.id, walletName: wallet.name, fromAccountId: from.id,
      amount, mode: v.from, date: today, reference: v.reference || undefined, createdById: user.id,
    });
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
