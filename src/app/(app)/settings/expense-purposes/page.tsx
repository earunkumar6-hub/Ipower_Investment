import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { AddDropdownValueForm, ToggleButton } from "../list-forms";
import { SettingsTabs } from "../settings-tabs";

/** Settings → Expense purposes: the purpose dropdown on the expense form ("Other" is always offered as well). */
export default async function ExpensePurposesPage() {
  const user = await requirePermission("Settings.Edit");
  const rows = await db.dropdownOption.findMany({ where: { tenantId: user.tenantId, list: "expensePurpose" }, orderBy: [{ active: "desc" }, { sort: "asc" }, { value: "asc" }] });

  return (
    <>
      <PageHeader title="Settings" user={user} />
      <SettingsTabs active="expense-purposes" />
      <div className="flex items-start gap-4">
        <div className="min-w-0 max-w-2xl flex-1 rounded-xl border bg-white p-4">
          <Table>
            <TableHeader><TableRow><TableHead>Purpose</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className={cn(!r.active && "text-muted-foreground")}>
                  <TableCell className="font-medium">{r.value}{r.addedByStaff && <span className="ml-1"><StatusBadge tone="orange">added by staff</StatusBadge></span>}</TableCell>
                  <TableCell><StatusBadge tone={r.active ? "green" : "slate"}>{r.active ? "In use" : "Removed"}</StatusBadge></TableCell>
                  <TableCell><ToggleButton kind="dropdown" id={r.id} active={r.active} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">Removing a purpose hides it from new expenses; old expenses keep it.</p>
        </div>
        <div className="w-80 shrink-0 rounded-xl border bg-white p-4">
          <AddDropdownValueForm list="expensePurpose" label="Add a purpose" />
        </div>
      </div>
    </>
  );
}
