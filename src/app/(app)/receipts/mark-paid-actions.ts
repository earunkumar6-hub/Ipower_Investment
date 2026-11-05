"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { refuseOnClosedDay } from "@/lib/action-guard";
import { assertDayOpen, balanceAt } from "@/lib/daybook";
import { fmtDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn } from "@/lib/leads";
import { fmtINR, sum } from "@/lib/money";
import { checkDenominations, denominationsField } from "@/lib/payment-options";
import { seesAll } from "@/lib/permissions";
import { postCompanyPayment, postPoDeposit, PRODUCT_CATEGORY } from "@/lib/posting";
import { authorize } from "@/lib/session";

const fail = (error: string): ActionResult => ({ ok: false, error });

const schema = z.object({
  receiptIds: z.string().transform((s) => s.split(",").filter(Boolean)).pipe(z.array(z.string()).min(1, "Tick the receipts paid to the company")),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date paid").transform((s) => new Date(`${s}T00:00:00Z`)),
  accountId: z.string().min(1, "Pick the account it was paid from"),
  reference: z.string().trim().min(2, "Enter the company receipt / UTR / PO receipt no.").max(60),
  denominations: denominationsField, // when paid from office cash: notes for the whole amount
});

/**
 * Receipts → Customer receipts: mark the ticked receipts as paid on to their companies in one go (owner, 4 Nov 2026).
 * Any companies at once: one company payment per company (insurer, AMC, post office for SSA / PPF), and the RD
 * receipts as one PO deposit – all with the same date, account and reference, each a Day Book money-out line, in one
 * transaction. Same checks as paying one receipt: open day, not before collection, balance, cash notes.
 */
export async function markReceiptsPaid(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("DayBook.Create");
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;
  if (v.paidOn > istToday()) return fail("The paid date can't be in the future");
  let summary = "";

  const r = await refuseOnClosedDay(() =>
    db.$transaction(async (tx): Promise<ActionResult> => {
      await assertDayOpen(tx, user.tenantId, v.paidOn);
      const receipts = await tx.receipt.findMany({
        where: {
          id: { in: v.receiptIds }, tenantId: user.tenantId, status: "Saved", ownerPaid: false, policyId: { not: null },
          OR: [
            { rdStatus: "Collected" }, // RD: waiting for the PO deposit
            { rdStatus: null, companyPaymentId: null, policy: { productType: { not: "PoRd" } } }, // others: waiting for the company payment
          ],
        },
        include: { policy: true },
        orderBy: { receiptNo: "asc" },
      });
      if (receipts.length !== v.receiptIds.length) return fail("Some receipts are no longer waiting to be paid to the company; reload and try again");
      if (receipts.some((x) => !seesAll(user.role) && x.createdById !== user.id && !canActOn(user, x.policy!.ownerId))) return fail("Some receipts belong to another user's customers");
      const late = receipts.find((x) => x.receiptDate > v.paidOn);
      if (late) return fail(`${late.receiptNo} was collected on ${fmtDate(late.receiptDate)}, after the paid date`);
      const account = await tx.account.findFirst({ where: { id: v.accountId, tenantId: user.tenantId, type: { in: ["Cash", "Bank"] }, active: true } });
      if (!account) return fail("Pick the cash or bank account it was paid from");
      const total = sum(receipts.map((x) => x.amount));
      const balance = await balanceAt(tx, account.id, v.paidOn);
      if (balance.lt(total)) return fail(`${account.name} has only ${fmtINR(balance)}; the ticked receipts come to ${fmtINR(total)}`);
      const mode = account.type === "Cash" ? "Cash" as const : "Bank" as const;
      const notes = mode === "Cash" ? checkDenominations(v.denominations, total) : null;
      if (notes && "error" in notes) return fail(notes.error);
      // The note count covers everything paid out; it is kept on the first Day Book line.
      let denominations: Prisma.InputJsonValue | undefined = notes?.ok;
      const takeNotes = () => { const d = denominations; denominations = undefined; return d; };

      const rd = receipts.filter((x) => x.rdStatus === "Collected");
      const byCompany = new Map<string, typeof receipts>();
      for (const x of receipts.filter((x) => x.rdStatus !== "Collected")) byCompany.set(x.policy!.partner, [...(byCompany.get(x.policy!.partner) ?? []), x]);
      const done: string[] = [];

      for (const [company, list] of byCompany) {
        const amount = sum(list.map((x) => x.amount));
        const payment = await tx.companyPayment.create({
          data: { tenantId: user.tenantId, company, paidOn: v.paidOn, accountId: account.id, mode, amount, reference: v.reference, createdById: user.id },
        });
        const updated = await tx.receipt.updateMany({ where: { id: { in: list.map((x) => x.id) }, companyPaymentId: null }, data: { companyPaymentId: payment.id } });
        if (updated.count !== list.length) throw new Error("Receipts changed while saving; try again");
        await postCompanyPayment(tx, payment, { receiptCount: list.length, productCategory: PRODUCT_CATEGORY[list[0].policy!.productType], denominations: takeNotes() });
        done.push(`${company} ${fmtINR(amount)}`);
      }

      if (rd.length) {
        const amount = sum(rd.map((x) => x.amount));
        const deposit = await tx.poDeposit.create({
          data: {
            tenantId: user.tenantId, poReceiptNo: v.reference, depositDate: v.paidOn, amount, receiptsTotal: amount,
            upiPortion: sum(rd.filter((x) => x.mode !== "Cash").map((x) => x.amount)),
            adjustmentReason: `Deposited from Receipts (${rd.map((x) => x.receiptNo).join(", ")}; paid from ${account.name}; no UPI vs ATM check)`,
            createdById: user.id, lines: { create: rd.map((x) => ({ receiptId: x.id, policyId: x.policyId!, amount: x.amount })) },
          },
        });
        const updated = await tx.receipt.updateMany({ where: { id: { in: rd.map((x) => x.id) }, rdStatus: "Collected" }, data: { rdStatus: "Deposited" } });
        if (updated.count !== rd.length) throw new Error("Receipts changed while saving; try again");
        await tx.commission.updateMany({ where: { receiptId: { in: rd.map((x) => x.id) } }, data: { poDepositId: deposit.id } });
        await postPoDeposit(tx, deposit, { accountId: account.id, mode, receiptCount: rd.length, denominations: takeNotes() });
        done.push(`Post office RD deposit ${fmtINR(amount)}`);
      }
      summary = `${receipts.length} ${receipts.length === 1 ? "receipt" : "receipts"} marked paid: ${done.join(" · ")}`;
      return { ok: true };
    }),
  );
  if (r.ok) revalidatePath("/", "layout");
  return r.ok ? { ok: true, message: summary } : r;
}
