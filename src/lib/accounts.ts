import type { Account, BankAccountKind, PaymentMode, WalletKind } from "@prisma/client";
import type { Tx } from "@/lib/db";

/**
 * The default cash and bank accounts (Settings → Bank accounts and wallets), used by screens that don't yet let staff
 * pick the account. Falls back to the first active one if no default is set.
 */
export async function cashAndBank(tx: Pick<Tx, "account">, tenantId: string) {
  const pick = (type: "Cash" | "Bank") =>
    tx.account.findFirstOrThrow({ where: { tenantId, type, active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  const [cash, bank] = await Promise.all([pick("Cash"), pick("Bank")]);
  return { cash, bank };
}

/** Cash goes to the cash drawer; UPI, bank transfers, cards and cheques land in the bank. */
export const receivingAccountId = (mode: PaymentMode, a: { cash: { id: string }; bank: { id: string } }) =>
  mode === "Cash" ? a.cash.id : a.bank.id;

export const ACCOUNT_KIND_LABEL: Record<BankAccountKind, string> = { Savings: "Savings", Current: "Current" };
export const WALLET_KIND_LABEL: Record<WalletKind, string> = { CSC: "CSC wallet", ESevai: "E-Sevai wallet", Other: "Other wallet" };

/** "SBI ••1234" for bank accounts, the name for cash and wallets. */
export const accountLabel = (a: Pick<Account, "type" | "name" | "bankName" | "last4">) =>
  a.type === "Bank" && a.bankName && a.last4 ? `${a.bankName} ••${a.last4}` : a.name;

/** Active cash and bank accounts for a "From account" / "Into account" picker: default first. */
export function moneyAccounts(tx: Pick<Tx, "account">, tenantId: string) {
  return tx.account.findMany({
    where: { tenantId, type: { in: ["Cash", "Bank"] }, active: true },
    orderBy: [{ type: "asc" }, { isDefault: "desc" }, { name: "asc" }],
  });
}
