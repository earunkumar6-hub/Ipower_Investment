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

/** Active bank accounts for the "Received into" picker (receipts, direct bills): default first. */
export async function bankAccountOptions(tx: Pick<Tx, "account">, tenantId: string) {
  const rows = await tx.account.findMany({ where: { tenantId, type: "Bank", active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  return rows.map((a) => ({ id: a.id, label: accountLabel(a) }));
}

/**
 * Where a receipt's money lands: cash goes to the cash drawer; any other mode needs the active bank account
 * staff picked as "Received into".
 */
export async function receivingAccount(
  tx: Pick<Tx, "account">, tenantId: string, mode: PaymentMode, intoAccountId: string,
): Promise<{ ok: Account } | { error: string }> {
  if (mode === "Cash") {
    const cash = await tx.account.findFirstOrThrow({ where: { tenantId, type: "Cash", active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
    return { ok: cash };
  }
  if (!intoAccountId) return { error: "Pick the bank account the money came into" };
  const bank = await tx.account.findFirst({ where: { id: intoAccountId, tenantId, type: "Bank", active: true } });
  if (!bank) return { error: "That bank account is switched off or not found; pick another" };
  return { ok: bank };
}
