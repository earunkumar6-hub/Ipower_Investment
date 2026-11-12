import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { MODE_LABEL, type ReceiptMode } from "@/lib/payment-modes";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { PayModeForm, PayModeRowActions, ToggleButton } from "../list-forms";
import { SettingsTabs } from "../settings-tabs";

const MODE_NOTE: Record<ReceiptMode, string> = {
  Cash: "Cash denomination required",
  UPI: "UTR required",
  NetBanking: "NEFT / IMPS / RTGS – customer's bank (typed) and transaction ID required",
  Cheque: "Cheque number required",
  Card: "Card approval number required",
};

/**
 * Settings → Payment modes: modes offered on receipts and direct bills. Built-in modes can be switched off; the agency
 * can add its own (a name that works like a built-in mode), change them and delete unused ones (owner change list, #28).
 * The customer bank list is gone – the bank name is typed on the receipt (#29).
 */
export default async function PaymentModesPage() {
  const user = await requirePermission("Settings.Edit");
  const modes = await db.paymentOption.findMany({ where: { tenantId: user.tenantId, kind: "Mode" }, orderBy: [{ sort: "asc" }, { name: "asc" }] });

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
                  <TableCell className="font-medium">
                    {m.base ? m.name : MODE_LABEL[m.name as ReceiptMode] ?? m.name}
                    {m.base && <span className="block text-xs font-normal text-muted-foreground">Added here · works like {MODE_LABEL[m.base]}</span>}
                  </TableCell>
                  <TableCell className="text-sm">{MODE_NOTE[(m.base ?? m.name) as ReceiptMode] ?? ""}</TableCell>
                  <TableCell><StatusBadge tone={m.active ? "green" : "slate"}>{m.active ? "On" : "Off"}</StatusBadge></TableCell>
                  <TableCell>
                    <span className="flex items-start justify-end gap-1">
                      <ToggleButton kind="payOption" id={m.id} active={m.active} />
                      {m.base && <PayModeRowActions mode={{ id: m.id, name: m.name, base: m.base }} />}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            The agency account the money lands in comes from Settings → Bank accounts and wallets. The five built-in modes can only be switched on or off.
            A mode added here can be changed, and deleted while no receipt or bill uses it; after that it can only be switched off.
          </p>
        </div>
        <div className="w-80 shrink-0 space-y-3 rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Add a pay mode</h2>
          <p className="text-xs text-muted-foreground">For example GPay or PhonePe working like UPI, or DD working like Cheque. Staff enter what the mode it works like needs.</p>
          <PayModeForm />
        </div>
      </div>
    </>
  );
}
