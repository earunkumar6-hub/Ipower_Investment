import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { istToday } from "@/lib/dates";
import { pnlMonth } from "@/lib/lists";
import { fmtINR } from "@/lib/money";
import { monthKey, monthRange, previousMonthKey, profitAndLoss } from "@/lib/pnl";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";

const nextMonthKey = (key: string) => monthKey(new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 1)));

export default async function PnlPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  // PnL.View is granted to the Super Admin only; Admins and staff are redirected.
  const user = await requirePermission("PnL.View");
  const current = monthKey(istToday());
  const key = pnlMonth(await searchParams, current);
  const [pnl, prev] = await Promise.all([
    profitAndLoss(user.tenantId, monthRange(key)),
    profitAndLoss(user.tenantId, monthRange(previousMonthKey(key))),
  ]);
  const prevExpense = (label: string) => prev.expenseLines.find((l) => l.label === label)?.amount;
  const prevService = (label: string) => prev.serviceLines.find((l) => l.label === label)?.amount;

  return (
    <>
      <PageHeader title="Profit & Loss" user={user} actions={
        <div className="flex items-center gap-1">
          <Link href={`/pnl?month=${previousMonthKey(key)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>←</Link>
          <span className="px-2 text-sm font-medium">{pnl.range.label}</span>
          {key < current && <Link href={`/pnl?month=${nextMonthKey(key)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>→</Link>}
          <ExportButton report="pnl" user={user} params={{ month: key }} />
        </div>
      } />
      <div className="flex items-start gap-4">
        <div className="max-w-3xl flex-1 rounded-xl border bg-white p-4">
          <Table>
            <TableHeader>
              <TableRow><TableHead /><TableHead className="text-right">{pnl.range.label}</TableHead><TableHead className="text-right text-muted-foreground">{prev.range.label}</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              <Section title="Income" />
              {pnl.serviceLines.map((l) => <Line key={l.label} label={`Service charges – ${l.label}`} value={fmtINR(l.amount)} prev={fmtINR(prevService(l.label) ?? 0)} indent />)}
              <Line label="Other income (entered in Day Book)" value={fmtINR(pnl.otherIncome)} prev={fmtINR(prev.otherIncome)} indent />
              <Line label="Total income" value={fmtINR(pnl.income)} prev={fmtINR(prev.income)} strong />
              <Section title="Less: expenses by category" />
              {pnl.expenseLines.map((l) => <Line key={l.label} label={l.label} value={fmtINR(l.amount)} prev={fmtINR(prevExpense(l.label) ?? 0)} indent />)}
              {pnl.expenseLines.length === 0 && <Line label="No expenses" value="—" indent />}
              <Line label="Total expenses" value={fmtINR(pnl.expenseTotal)} prev={fmtINR(prev.expenseTotal)} strong />
              <TableRow className={cn("text-base font-semibold", pnl.profit.isNegative() ? "text-destructive" : "text-green-800")}>
                <TableCell>{pnl.profit.isNegative() ? "Loss" : "Profit"}</TableCell>
                <TableCell className="text-right">{fmtINR(pnl.profit)}</TableCell>
                <TableCell className="text-right text-sm font-normal text-muted-foreground">{fmtINR(prev.profit)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <div className="w-80 shrink-0 space-y-3 rounded-xl border bg-white p-4 text-xs text-muted-foreground">
          <h2 className="text-sm font-semibold text-foreground">How this is worked out</h2>
          <p>Service charges are what customers paid minus the provider cost (EB ₹10/₹20 slab, PAN ₹100, certificate ₹88).</p>
          <p>Expenses count on the date they were spent, whoever paid (company, employee or owner). Waiting, rejected and cancelled expenses are left out.</p>
          <p>Other income is what an Admin records in the Day Book as Other income (interest, incentives…), less any reversals.</p>
          <p>Not income: premiums and bills collected on behalf of insurers, the post office and the EB board; wallet recharges; transfers between own accounts; owner-paid bills. Commission is not counted.</p>
          <p className="font-medium text-foreground">Visible to the Super Admin only.</p>
        </div>
      </div>
    </>
  );
}

function Section({ title }: { title: string }) {
  return <TableRow className="bg-slate-50 hover:bg-slate-50"><TableCell colSpan={3} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</TableCell></TableRow>;
}

function Line({ label, value, prev, indent, strong }: { label: string; value: string; prev?: string; indent?: boolean; strong?: boolean }) {
  return (
    <TableRow className={cn(strong && "font-semibold")}>
      <TableCell className={cn("whitespace-normal", indent && "pl-6")}>{label}</TableCell>
      <TableCell className="text-right">{value}</TableCell>
      <TableCell className="text-right text-muted-foreground">{prev ?? ""}</TableCell>
    </TableRow>
  );
}
