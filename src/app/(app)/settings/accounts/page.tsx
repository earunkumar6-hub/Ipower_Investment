import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ACCOUNT_KIND_LABEL, WALLET_KIND_LABEL } from "@/lib/accounts";
import { istToday } from "@/lib/dates";
import { accountDay } from "@/lib/daybook";
import { db } from "@/lib/db";
import { fmtINR } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { SettingsTabs } from "../settings-tabs";
import { AccountActions, BankAccountForm, WalletForm } from "./account-forms";

const TYPE_ORDER = { Cash: 0, Bank: 1, Wallet: 2 } as const;

/** Settings → Bank accounts and wallets: used in the account dropdowns wherever money moves. Never deleted, only switched off. */
export default async function AccountsSettingsPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const user = await requirePermission("Settings.Edit");
  const { edit } = await searchParams;
  const [accounts, days] = await Promise.all([
    db.account.findMany({ where: { tenantId: user.tenantId } }),
    accountDay(db, user.tenantId, istToday()),
  ]);
  accounts.sort((a, b) => Number(b.active) - Number(a.active) || TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.name.localeCompare(b.name));
  const balance = (id: string) => days.find((d) => d.accountId === id)?.closing;
  const editing = accounts.find((a) => a.id === edit && a.type !== "Cash");

  return (
    <>
      <PageHeader title="Settings" user={user} />
      <SettingsTabs active="accounts" />
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 rounded-xl border bg-white p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead><TableHead>Type</TableHead><TableHead>Bank details</TableHead><TableHead className="text-right">Balance now</TableHead><TableHead>Status</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id} className={cn(!a.active && "text-muted-foreground")}>
                  <TableCell className="font-medium">
                    {a.name}
                    {a.isDefault && a.type === "Bank" && <span className="ml-1"><StatusBadge tone="orange">Default</StatusBadge></span>}
                  </TableCell>
                  <TableCell>{a.type === "Bank" ? `Bank${a.accountKind ? ` · ${ACCOUNT_KIND_LABEL[a.accountKind]}` : ""}` : a.type === "Wallet" ? (a.walletKind ? WALLET_KIND_LABEL[a.walletKind] : "Wallet (older)") : "Office cash"}</TableCell>
                  <TableCell className="text-sm">
                    {[a.bankName, a.branch, a.last4 && `••••${a.last4}`].filter(Boolean).join(" · ") || "—"}
                    {(a.ifsc || a.micr) && <span className="block text-xs text-muted-foreground">{[a.ifsc && `IFSC ${a.ifsc}`, a.micr && `MICR ${a.micr}`].filter(Boolean).join(" · ")}</span>}
                  </TableCell>
                  <TableCell className="text-right">{fmtINR(balance(a.id) ?? a.openingBalance)}</TableCell>
                  <TableCell><StatusBadge tone={a.active ? "green" : "slate"}>{a.active ? "Active" : "Switched off"}</StatusBadge></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {a.type !== "Cash" && <Link href={`/settings/accounts?edit=${a.id}`} className="px-2 text-sm text-brand-700 hover:underline">Edit</Link>}
                      {a.type !== "Cash" && <AccountActions id={a.id} active={a.active} canDefault={a.type === "Bank" && a.active && !a.isDefault} />}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Accounts are never deleted. A switched-off account is hidden from new entries but still shows on old ones.
            The default bank account is where money lands on screens that don&apos;t yet ask which account.
          </p>
        </div>
        <div className="w-80 shrink-0 space-y-4">
          {editing?.type === "Bank" ? (
            <BankAccountForm key={editing.id} value={{ id: editing.id, bankName: editing.bankName ?? "", branch: editing.branch ?? "", last4: editing.last4, ifsc: editing.ifsc ?? "", micr: editing.micr ?? "", accountKind: editing.accountKind ?? "" }} />
          ) : editing?.type === "Wallet" ? (
            <WalletForm key={editing.id} value={{ id: editing.id, walletKind: editing.walletKind ?? "Other", otherName: editing.walletKind && editing.walletKind !== "Other" ? "" : editing.name, lowBalanceThreshold: editing.lowBalanceThreshold?.toFixed(2) ?? "" }} />
          ) : (
            <>
              <BankAccountForm />
              <WalletForm />
            </>
          )}
        </div>
      </div>
    </>
  );
}
