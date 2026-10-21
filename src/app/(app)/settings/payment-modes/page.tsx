import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { MODE_LABEL, type ReceiptMode } from "@/lib/payment-modes";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { AddCustomerBankForm, ToggleButton } from "../list-forms";
import { SettingsTabs } from "../settings-tabs";

const MODE_NOTE: Record<ReceiptMode, string> = {
  Cash: "Cash denomination required",
  UPI: "PhonePe / GPay – UTR required",
  NetBanking: "NEFT / IMPS / RTGS – customer's bank and transaction ID required",
  Cheque: "Cheque number required",
  Card: "Card approval number required",
};

/** Settings → Payment modes: modes offered on receipts and direct bills, and the customer bank list for net banking. */
export default async function PaymentModesPage() {
  const user = await requirePermission("Settings.Edit");
  const options = await db.paymentOption.findMany({ where: { tenantId: user.tenantId }, orderBy: [{ sort: "asc" }, { name: "asc" }] });
  const modes = options.filter((o) => o.kind === "Mode");
  const banks = options.filter((o) => o.kind === "Bank").sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader title="Settings" user={user} />
      <SettingsTabs active="payment-modes" />
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 rounded-xl border bg-white p-4">
          <h2 className="mb-2 font-semibold">Payment modes</h2>
          <Table>
            <TableHeader><TableRow><TableHead>Mode</TableHead><TableHead>What staff enter</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {modes.map((m) => (
                <TableRow key={m.id} className={cn(!m.active && "text-muted-foreground")}>
                  <TableCell className="font-medium">{MODE_LABEL[m.name as ReceiptMode] ?? m.name}</TableCell>
                  <TableCell className="text-sm">{MODE_NOTE[m.name as ReceiptMode] ?? ""}</TableCell>
                  <TableCell><StatusBadge tone={m.active ? "green" : "slate"}>{m.active ? "On" : "Off"}</StatusBadge></TableCell>
                  <TableCell><ToggleButton kind="payOption" id={m.id} active={m.active} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">The agency account the money lands in comes from Settings → Bank accounts and wallets.</p>
        </div>
        <div className="w-96 shrink-0 space-y-4 rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Customer banks (net banking)</h2>
          <p className="text-xs text-muted-foreground">The bank the customer paid from – reference only, printed on the receipt.</p>
          <ul className="divide-y text-sm">
            {banks.map((b) => (
              <li key={b.id} className={cn("flex items-center justify-between py-1.5", !b.active && "text-muted-foreground line-through")}>
                {b.name}<ToggleButton kind="payOption" id={b.id} active={b.active} />
              </li>
            ))}
          </ul>
          <AddCustomerBankForm />
        </div>
      </div>
    </>
  );
}
