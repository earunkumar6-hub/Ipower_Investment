import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { nameLookup } from "@/lib/deposit-status";
import { DROPDOWN_LISTS, type DropdownList } from "@/lib/dropdowns";
import { userNames } from "@/lib/leads";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { AddDropdownValueForm, ToggleButton } from "../list-forms";
import { SettingsTabs } from "../settings-tabs";

/**
 * Settings → Dropdown values: every list that offers "Other". Values staff typed under "Other" are tagged
 * "added by staff"; removing one hides it from new entries but keeps it on old records.
 */
export default async function DropdownValuesPage({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
  const user = await requirePermission("Settings.Edit");
  const sp = await searchParams;
  const list = (sp.list && sp.list in DROPDOWN_LISTS ? sp.list : "expensePurpose") as DropdownList;
  const [rows, counts, users] = await Promise.all([
    db.dropdownOption.findMany({ where: { tenantId: user.tenantId, list }, orderBy: [{ active: "desc" }, { sort: "asc" }, { createdAt: "asc" }] }),
    db.dropdownOption.groupBy({ by: ["list"], where: { tenantId: user.tenantId, addedByStaff: true, active: true }, _count: true }),
    userNames(user.tenantId),
  ]);
  const nameOf = nameLookup(users);
  const staffCount = (l: string) => counts.find((c) => c.list === l)?._count ?? 0;

  return (
    <>
      <PageHeader title="Settings" user={user} />
      <SettingsTabs active="dropdowns" />
      <div className="flex items-start gap-4">
        <nav className="w-56 shrink-0 space-y-1 rounded-xl border bg-white p-2 text-sm">
          {(Object.entries(DROPDOWN_LISTS) as [DropdownList, string][]).map(([key, label]) => (
            <Link key={key} href={`/settings/dropdowns?list=${key}`}
              className={cn("flex items-center justify-between rounded-md px-2 py-1.5", key === list ? "bg-saffron-50 font-medium text-brand-700" : "hover:bg-slate-50")}>
              {label}
              {staffCount(key) > 0 && <span className="rounded-full bg-orange-100 px-1.5 text-xs text-orange-800">{staffCount(key)}</span>}
            </Link>
          ))}
        </nav>
        <div className="min-w-0 max-w-2xl flex-1 rounded-xl border bg-white p-4">
          <h2 className="mb-2 font-semibold">{DROPDOWN_LISTS[list]}</h2>
          <Table>
            <TableHeader><TableRow><TableHead>Value</TableHead><TableHead>Added</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className={cn(!r.active && "text-muted-foreground")}>
                  <TableCell className="font-medium">{r.value}{r.addedByStaff && <span className="ml-1"><StatusBadge tone="orange">added by staff</StatusBadge></span>}</TableCell>
                  <TableCell className="text-sm">{r.createdById ? `${nameOf(r.createdById)} · ${fmtDate(r.createdAt)}` : "Starting list"}</TableCell>
                  <TableCell><StatusBadge tone={r.active ? "green" : "slate"}>{r.active ? "In use" : "Removed"}</StatusBadge></TableCell>
                  <TableCell><ToggleButton kind="dropdown" id={r.id} active={r.active} /></TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={4} className="py-4 text-center text-muted-foreground">No values yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            &quot;Other&quot; is always offered: what staff type there is saved on the entry and added here. Removing a value hides it from new entries; old records keep it.
          </p>
        </div>
        <div className="w-80 shrink-0 rounded-xl border bg-white p-4">
          <AddDropdownValueForm key={list} list={list} label={`Add to ${DROPDOWN_LISTS[list].toLowerCase()}`} />
        </div>
      </div>
    </>
  );
}
