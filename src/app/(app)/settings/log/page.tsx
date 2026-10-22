import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { nameLookup } from "@/lib/deposit-status";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { SettingsTabs } from "../settings-tabs";

const ENTITIES = [["all", "All"], ["Product", "Products"], ["Scheme", "Schemes and rates"], ["Policy", "Policies"], ["DayBook", "Day Book"], ["Account", "Bank accounts and wallets"], ["PaymentOption", "Payment modes"], ["DropdownOption", "Dropdown values"], ["Tenant", "Day Book settings"], ["Access", "Roles and access"], ["User", "Users"]] as const;
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

/** Change log: who changed what and when, with old and new values (latest 200). */
export default async function ChangeLogPage({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  const user = await requirePermission("Audit.View");
  const sp = await searchParams;
  const entity = ENTITIES.find(([k]) => k === sp.entity)?.[0] ?? "all";
  const [rows, users] = await Promise.all([
    db.auditLog.findMany({
      where: {
        tenantId: user.tenantId, ...(entity !== "all" && { entity }),
        // Commission is the owner's only: its log lines stay hidden from Admins.
        ...(!hasPermission(user.role, "Commission.View") && { NOT: { entity: "CommissionReceipt" } }),
      },
      orderBy: { createdAt: "desc" }, take: 200,
    }),
    db.user.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true } }),
  ]);
  const nameOf = nameLookup(users);

  return (
    <>
      <PageHeader title="Settings" user={user} />
      <SettingsTabs active="log" />
      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Show:</span>
          {ENTITIES.map(([k, label]) => (
            <Link key={k} href={k === "all" ? "/settings/log" : `/settings/log?entity=${k}`}
              className={cn("rounded-full px-3 py-0.5", entity === k ? "bg-saffron-100 text-saffron-900" : "text-muted-foreground hover:bg-slate-100")}>{label}</Link>
          ))}
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Who</TableHead><TableHead>What</TableHead><TableHead>Old → new</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => {
              const before = (r.before ?? {}) as Record<string, unknown>;
              const after = (r.after ?? {}) as Record<string, unknown>;
              const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
              return (
                <TableRow key={r.id} className="align-top">
                  <TableCell className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</TableCell>
                  <TableCell>{nameOf(r.userId)}</TableCell>
                  <TableCell className="whitespace-normal"><div className="font-medium">{r.action}</div><div className="text-xs text-muted-foreground">{r.summary}</div></TableCell>
                  <TableCell className="text-xs whitespace-normal">
                    {keys.map((k) => (
                      <div key={k}><span className="text-muted-foreground">{k}:</span> {r.before && <>{show(before[k])} → </>}{show(after[k])}</div>
                    ))}
                  </TableCell>
                  <TableCell className="whitespace-normal">{r.reason ?? "—"}</TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No changes recorded yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
