import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { DmyDateInput } from "@/components/dmy-date-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { balanceAt } from "@/lib/daybook";
import { ENTRY_LABEL } from "@/lib/daybook-view";
import { addDays, fmtDate, isoDate, istToday } from "@/lib/dates";
import { db, type Tx } from "@/lib/db";
import { fmtINR, ZERO } from "@/lib/money";
import { requirePermission } from "@/lib/session";

const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null);

/** Wallet statement (#6): every recharge and deduction for a date range, with the running balance. */
export default async function WalletStatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requirePermission("Service.Record");
  const { id } = await params;
  const sp = await searchParams;
  const wallet = await db.account.findFirst({ where: { id, tenantId: user.tenantId, type: "Wallet" } });
  if (!wallet) notFound();
  const today = istToday();
  const to = day(sp.to) ?? today;
  const from = day(sp.from) ?? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  const [opening, entries] = await Promise.all([
    balanceAt(db as unknown as Tx, wallet.id, addDays(from, -1)),
    db.dayBookEntry.findMany({ where: { accountId: wallet.id, entryDate: { gte: from, lte: to } }, orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }] }),
  ]);
  let running = opening;
  const rows = entries.map((e) => {
    running = e.direction === "In" ? running.plus(e.amount) : running.minus(e.amount);
    return { e, balance: running };
  });
  const sumOf = (dir: "In" | "Out") => entries.filter((e) => e.direction === dir).reduce((t, e) => t.plus(e.amount), ZERO);

  return (
    <>
      <PageHeader title={`Wallet statement · ${wallet.name}`} user={user} actions={<Link href="/esevai" className={buttonVariants({ variant: "ghost" })}>Back to ESEVAI &amp; CSC</Link>} />
      <div className="max-w-5xl rounded-xl border bg-white p-4">
        <form className="mb-3 flex items-end gap-2 text-sm">
          <label className="space-y-1"><span className="block text-xs text-muted-foreground">From</span><DmyDateInput id="ws-from" name="from" defaultValue={isoDate(from)} className="h-8" /></label>
          <label className="space-y-1"><span className="block text-xs text-muted-foreground">To</span><DmyDateInput id="ws-to" name="to" defaultValue={isoDate(to)} max={isoDate(today)} className="h-8" /></label>
          <button type="submit" className={buttonVariants({ size: "sm", variant: "outline" })}>Show</button>
        </form>
        <div className="mb-3 grid grid-cols-4 gap-3 text-sm">
          {[["Opening", opening], ["Recharge / in", sumOf("In")], ["Deducted / out", sumOf("Out")], ["Closing", running]].map(([k, v]) => (
            <div key={String(k)} className="rounded-lg border p-2"><div className="text-xs text-muted-foreground">{String(k)}</div><div className="font-semibold">{fmtINR(v as typeof opening)}</div></div>
          ))}
        </div>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Particulars</TableHead><TableHead className="text-right">In</TableHead><TableHead className="text-right">Out</TableHead><TableHead className="text-right">Balance</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="text-muted-foreground"><TableCell>{fmtDate(from)}</TableCell><TableCell colSpan={4}>Opening balance</TableCell><TableCell className="text-right">{fmtINR(opening)}</TableCell></TableRow>
            {rows.map(({ e, balance }) => (
              <TableRow key={e.id}>
                <TableCell>{fmtDate(e.entryDate)}</TableCell>
                <TableCell>{e.reversalOfId ? "Reversal" : ENTRY_LABEL[e.entryType]}</TableCell>
                <TableCell className="whitespace-normal">{e.particulars}</TableCell>
                <TableCell className="text-right">{e.direction === "In" ? fmtINR(e.amount) : ""}</TableCell>
                <TableCell className="text-right">{e.direction === "Out" ? fmtINR(e.amount) : ""}</TableCell>
                <TableCell className="text-right">{fmtINR(balance)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No wallet movements in this range.</TableCell></TableRow>}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">Uploading the provider&apos;s statement to match it line by line will come once a sample CSC / E-Sevai statement file is available.</p>
      </div>
    </>
  );
}
