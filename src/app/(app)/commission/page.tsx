import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { accountLabel } from "@/lib/accounts";
import { commissionSources, commissionSummary, fyOfMonth, monthName } from "@/lib/commission-received";
import { fmtDate, isoDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { fmtINR, ZERO } from "@/lib/money";
import { monthKey } from "@/lib/pnl";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { CancelCommission, CommissionForm } from "./commission-forms";

/** Commission received (#18) – Super Admin only (Admins and Users are redirected, like P&L). */
export default async function CommissionPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const user = await requirePermission("Commission.View");
  const today = istToday();
  const month = monthKey(today);
  const sp = await searchParams;
  const fy = sp.fy && /^\d{4}-\d{2}$/.test(sp.fy) ? sp.fy : fyOfMonth(month);
  const [s, sources, banks] = await Promise.all([
    commissionSummary(user.tenantId, month, fy),
    commissionSources(user.tenantId),
    db.account.findMany({ where: { tenantId: user.tenantId, type: "Bank", active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
  ]);
  const fyTotal = s.byMonth.reduce((t, m) => t.plus(m.amount), ZERO);

  return (
    <>
      <PageHeader title="Commission received" user={user} actions={<ExportButton report="commission" user={user} params={{ fy }} />} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard title="This month" value={fmtINR(s.cards.thisMonth)} sub={`For ${monthName(month)}`} highlight />
        <StatCard title="This financial year" value={fmtINR(s.cards.thisFy)} sub={`FY ${fyOfMonth(month)} (Apr–Mar)`} />
        <StatCard title="Entries this month" value={String(s.cards.entriesThisMonth)} sub={`For ${monthName(month)}`} />
      </div>
      <div className="mb-4 flex items-start gap-4">
        <div className="w-[30rem] shrink-0"><CommissionForm sources={sources} banks={banks.map((b) => ({ id: b.id, label: accountLabel(b) }))} month={month} today={isoDate(today)} /></div>
        <div className="min-w-0 flex-1 space-y-4">
          <div className="rounded-xl border bg-white p-4">
            <h2 className="mb-2 font-semibold">By month · FY {fy}</h2>
            <Table>
              <TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">Entries</TableHead><TableHead className="text-right">Commission</TableHead></TableRow></TableHeader>
              <TableBody>
                {s.byMonth.map((m) => (
                  <TableRow key={m.month} className={cn(m.month > month && "text-muted-foreground")}>
                    <TableCell>{monthName(m.month)}</TableCell><TableCell className="text-right">{m.entries || "—"}</TableCell><TableCell className="text-right">{fmtINR(m.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold"><TableCell>Total FY {fy}</TableCell><TableCell /><TableCell className="text-right">{fmtINR(fyTotal)}</TableCell></TableRow>
              </TableBody>
            </Table>
          </div>
          <div className="rounded-xl border bg-white p-4">
            <h2 className="mb-2 font-semibold">By financial year</h2>
            <Table>
              <TableHeader><TableRow><TableHead>FY (Apr–Mar)</TableHead><TableHead className="text-right">Entries</TableHead><TableHead className="text-right">Commission</TableHead></TableRow></TableHeader>
              <TableBody>
                {s.byFy.map((y) => (
                  <TableRow key={y.fy}>
                    <TableCell><Link href={`/commission?fy=${y.fy}`} className={cn("hover:underline", y.fy === fy && "font-semibold text-brand-700")}>{y.fy}</Link></TableCell>
                    <TableCell className="text-right">{y.entries}</TableCell><TableCell className="text-right">{fmtINR(y.amount)}</TableCell>
                  </TableRow>
                ))}
                {s.byFy.length === 0 && <TableRow><TableCell colSpan={3} className="py-4 text-center text-muted-foreground">No commission recorded yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
      <div className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 font-semibold">Entries · FY {fy}</h2>
        <Table>
          <TableHeader>
            <TableRow><TableHead>For month</TableHead><TableHead>Source</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Received into</TableHead><TableHead>UTR / txn no.</TableHead><TableHead>Date received</TableHead><TableHead>Note</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {s.entries.map((e) => (
              <TableRow key={e.id} className={cn(e.status === "Cancelled" && "text-muted-foreground")}>
                <TableCell>{monthName(e.forMonth)}</TableCell>
                <TableCell>{e.source}</TableCell>
                <TableCell className="text-right">{fmtINR(e.amount)}</TableCell>
                <TableCell>{accountLabel(e.account)}</TableCell>
                <TableCell>{e.reference}</TableCell>
                <TableCell>{fmtDate(e.receivedOn)}</TableCell>
                <TableCell className="whitespace-normal">{e.note ?? "—"}</TableCell>
                <TableCell>{e.status === "Cancelled" ? <StatusBadge tone="slate">Cancelled</StatusBadge> : <StatusBadge tone="green">Saved</StatusBadge>}{e.cancelReason && <span className="block text-xs">{e.cancelReason}</span>}</TableCell>
                <TableCell className="text-right">{e.status === "Saved" && <CancelCommission id={e.id} />}</TableCell>
              </TableRow>
            ))}
            {s.entries.length === 0 && <TableRow><TableCell colSpan={9} className="py-6 text-center text-muted-foreground">No entries for FY {fy}.</TableCell></TableRow>}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">Visible to the Super Admin only. Not shown on receipts, the Day Book, dashboards or exports for Admins and Users.</p>
      </div>
    </>
  );
}
