import type { PaymentMode } from "@prisma/client";
import type { Tx } from "@/lib/db";

/** Demo has one cash account and one bank account (SBI ••1234). */
export async function cashAndBank(tx: Tx, tenantId: string) {
  const [cash, bank] = await Promise.all([
    tx.account.findFirstOrThrow({ where: { tenantId, type: "Cash" } }),
    tx.account.findFirstOrThrow({ where: { tenantId, type: "Bank" } }),
  ]);
  return { cash, bank };
}

/** Cash goes to the cash drawer; UPI, bank transfers, cards and cheques land in the bank. */
export const receivingAccountId = (mode: PaymentMode, a: { cash: { id: string }; bank: { id: string } }) =>
  mode === "Cash" ? a.cash.id : a.bank.id;
