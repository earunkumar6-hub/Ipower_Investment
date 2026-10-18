import type { Expense, Policy, PoDeposit, Prisma, ProductType, Receipt, ServiceTransaction } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { post } from "@/lib/daybook";

// Maps each business record to its Day Book lines. Called in the same transaction
// that saves the record (the demo's stand-in for the full build's outbox worker).

export const PRODUCT_CATEGORY: Record<ProductType, string> = {
  Insurance: "Insurance",
  MutualFund: "Mutual fund",
  PoRd: "Post office",
  PoTd: "Post office",
  PoKvp: "Post office",
  PoNsc: "Post office",
};

const SCHEME: Partial<Record<ProductType, string>> = {
  PoRd: "Post office RD",
  PoTd: "Post office TD",
  PoKvp: "KVP",
  PoNsc: "NSC",
};

export const schemeOf = (p: Pick<Policy, "productType" | "partner" | "productName">) =>
  SCHEME[p.productType] ?? `${p.partner} ${p.productName}`;

export function postReceipt(tx: Tx, r: Receipt, ctx: { customerName: string; policy: Policy | null }) {
  return post(tx, {
    tenantId: r.tenantId,
    entryDate: r.receiptDate,
    sourceType: "Receipt",
    sourceId: r.id,
    sourceNo: r.receiptNo,
    createdById: r.createdById,
    lines: [
      {
        key: "in",
        accountId: r.accountId,
        direction: "In",
        amount: r.amount,
        entryType: "Collection",
        mode: r.mode,
        isPassThrough: r.isPassThrough,
        particulars: `${r.receiptNo} · ${ctx.customerName}`,
        productCategory: ctx.policy ? PRODUCT_CATEGORY[ctx.policy.productType] : "Other",
        scheme: ctx.policy ? schemeOf(ctx.policy) : undefined,
        notes: r.notes ?? undefined,
      },
    ],
  });
}

/** Customer payment in (cash/bank) and provider cost out (wallet/bank). Profit is read by P&L from the transaction. */
export function postServiceTransaction(tx: Tx, t: ServiceTransaction, ctx: { serviceCode: string; serviceName: string }) {
  const particulars = `${t.txnNo} · ${ctx.serviceName}${t.customerName ? ` · ${t.customerName}` : ""}`;
  return post(tx, {
    tenantId: t.tenantId,
    entryDate: t.txnDate,
    sourceType: "ServiceTransaction",
    sourceId: t.id,
    sourceNo: t.txnNo,
    createdById: t.createdById,
    lines: [
      {
        key: "in",
        accountId: t.receivedAccountId,
        direction: "In",
        amount: t.customerAmount,
        entryType: "ServiceCollection",
        mode: t.paymentMode,
        particulars,
        productCategory: "E-Sevai",
        scheme: ctx.serviceName,
      },
      {
        key: "cost",
        accountId: t.paidFromAccountId,
        direction: "Out",
        amount: t.walletCost,
        entryType: "ServiceCost",
        isPassThrough: ctx.serviceCode === "EB",
        particulars,
        productCategory: "E-Sevai",
        scheme: ctx.serviceName,
      },
    ],
  });
}

/** Company money leaving for an expense: paid directly, or repaid to the employee/owner. */
export function postExpensePayment(tx: Tx, e: Expense, ctx: { vendorName: string; date: Date; createdById: string; mode?: Expense["mode"] }) {
  const repayment = e.paidBy !== "Company";
  const accountId = repayment ? e.repaidFromAccountId : e.fromAccountId;
  if (!accountId) throw new Error(`${e.expenseNo}: no company account to pay from`);
  return post(tx, {
    tenantId: e.tenantId,
    entryDate: ctx.date,
    sourceType: "Expense",
    sourceId: e.id,
    sourceNo: e.expenseNo,
    createdById: ctx.createdById,
    lines: [
      {
        key: repayment ? "repaid" : "paid",
        accountId,
        direction: "Out",
        amount: e.amount,
        entryType: repayment ? "ExpenseRepayment" : "Expense",
        mode: ctx.mode ?? e.mode,
        particulars: `${e.expenseNo} · ${e.description}${repayment ? ` (repaid to ${e.paidByName})` : ""}`,
        productCategory: e.category,
        scheme: ctx.vendorName,
      },
    ],
  });
}

/** Cash taken to the post office for the ticked RD receipts. */
export function postPoDeposit(tx: Tx, d: PoDeposit, ctx: { cashAccountId: string; receiptCount: number }) {
  return post(tx, {
    tenantId: d.tenantId,
    entryDate: d.depositDate,
    sourceType: "PoDeposit",
    sourceId: d.id,
    sourceNo: d.poReceiptNo,
    createdById: d.createdById,
    lines: [
      {
        key: "out",
        accountId: ctx.cashAccountId,
        direction: "Out",
        amount: d.amount,
        entryType: "DepositToPo",
        mode: "Cash",
        isPassThrough: true,
        particulars: `PO receipt ${d.poReceiptNo} · ${ctx.receiptCount} receipts`,
        productCategory: "Post office",
        scheme: "Post office RD",
      },
    ],
  });
}

/** Money collected from the customer handed back to the owner who paid the PO first. */
export function postOwnerReturn(tx: Tx, slip: { id: string; tenantId: string; slipNo: string; amount: Prisma.Decimal }, ctx: { accountId: string; mode: "Cash" | "Bank"; date: Date; createdById: string }) {
  return post(tx, {
    tenantId: slip.tenantId,
    entryDate: ctx.date,
    sourceType: "OwnerPaidSlip",
    sourceId: slip.id,
    sourceNo: slip.slipNo,
    createdById: ctx.createdById,
    lines: [
      {
        key: "return",
        accountId: ctx.accountId,
        direction: "Out",
        amount: slip.amount,
        entryType: "OwnerReturn",
        mode: ctx.mode,
        isPassThrough: true,
        particulars: `${slip.slipNo} · returned to owner`,
        productCategory: "Post office",
        scheme: "Post office RD",
      },
    ],
  });
}

/** Prepaid top-up: money leaves bank/cash and lands in the wallet (a transfer, never an expense). */
export function postWalletRecharge(
  tx: Tx,
  r: { id: string; tenantId: string; walletId: string; walletName: string; fromAccountId: string; amount: Prisma.Decimal; mode: "Bank" | "Cash"; date: Date; reference?: string; createdById: string },
) {
  const particulars = `${r.walletName} recharge${r.reference ? ` · ${r.reference}` : ""}`;
  return post(tx, {
    tenantId: r.tenantId,
    entryDate: r.date,
    sourceType: "WalletRecharge",
    sourceId: r.id,
    createdById: r.createdById,
    lines: [
      { key: "out", accountId: r.fromAccountId, direction: "Out", amount: r.amount, entryType: "WalletRecharge", mode: r.mode, particulars, productCategory: "E-Sevai", scheme: r.walletName },
      { key: "in", accountId: r.walletId, direction: "In", amount: r.amount, entryType: "WalletRecharge", mode: r.mode, particulars, productCategory: "E-Sevai", scheme: r.walletName },
    ],
  });
}
