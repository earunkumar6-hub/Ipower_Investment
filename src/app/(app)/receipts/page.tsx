import type { OwnerPaidSlipStatus, Prisma } from "@prisma/client";
import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addMonths, fmtDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { ownerScope } from "@/lib/leads";
import { monthLabel, receiptTab, SLIP_STATUS } from "@/lib/lists";
import { fmtINR, sum, ZERO } from "@/lib/money";
import { hasPermission, seesAll } from "@/lib/permissions";
import { requirePermission, type SessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { OwnerPaidForm, ReturnToOwnerForm } from "./owner-paid-forms";

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePermission("Receipt.View");
  const tab = receiptTab(await searchParams);
  const showCommission = hasPermission(user.role, "Commission.View");

  return (
    <>
      <PageHeader title="Receipts" user={user} actions={<>
        <ExportButton report="receipts" user={user} />
        <Link href="/receipts/new" className={cn(buttonVariants(), "bg-blue-600 hover:bg-blue-700")}>New receipt</Link>
      </>} />
      <div className="mb-4 flex gap-1 border-b">
        {[["customer", "Customer receipts"], ["owner", "Owner-paid RD"]].map(([key, label]) => (
          <Link key={key} href={`/receipts?tab=${key}`}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === key ? "border-blue-600 font-medium text-blue-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {label}
          </Link>
        ))}
      </div>
      {tab === "customer" ? <CustomerReceipts tenantId={user.tenantId} createdById={seesAll(user.role) ? undefined : user.id} showCommission={showCommission} />
        : <OwnerPaid user={user} />}
    </>
  );
}

async function CustomerReceipts({ tenantId, createdById, showCommission }: { tenantId: string; createdById?: string; showCommission: boolean }) {
  const receipts = await db.receipt.findMany({
    where: { tenantId, ...(createdById && { createdById }) },
    include: {
      customer: { select: { name: true } },
      policy: { select: { partner: true, productName: true, policyNumber: true } },
      // Commission is only read for roles allowed to see it.
      ...(showCommission && { commissions: { where: { status: { not: "Cancelled" } }, select: { gross: true } } }),
    },
    orderBy: [{ receiptDate: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  const accounts = await db.account.findMany({ where: { tenantId }, select: { id: true, name: true } });
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "—";

  return (
    <div className="rounded-xl border bg-white p-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Receipt no.</TableHead><TableHead>Bill date</TableHead><TableHead>Txn date</TableHead><TableHead>Customer</TableHead><TableHead>For</TableHead>
            <TableHead>Mode</TableHead><TableHead>Account</TableHead><TableHead className="text-right">Amount</TableHead>
            {showCommission && <TableHead className="text-right">Commission</TableHead>}
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {receipts.map((r) => {
            const commission = "commissions" in r ? (r.commissions as { gross: Prisma.Decimal }[]) : [];
            return (
              <TableRow key={r.id} className={cn(r.status === "Cancelled" && "text-muted-foreground")}>
                <TableCell><Link href={`/receipts/${r.id}`} className="text-blue-700 hover:underline">{r.receiptNo}</Link></TableCell>
                <TableCell>{fmtDate(r.receiptDate)}</TableCell>
                <TableCell>{fmtDate(r.txnDate)}</TableCell>
                <TableCell>{r.customer.name}</TableCell>
                <TableCell>{r.policy ? `${r.policy.partner === "Post Office" ? r.policy.policyNumber : `${r.policy.partner} ${r.policy.productName}`}` : r.notes}{r.ownerPaid && " (owner-paid)"}</TableCell>
                <TableCell>{r.mode}</TableCell>
                <TableCell>{accountName(r.accountId)}</TableCell>
                <TableCell className="text-right">{fmtINR(r.amount)}</TableCell>
                {showCommission && <TableCell className="text-right">{commission.length ? fmtINR(sum(commission.map((c) => c.gross))) : "—"}</TableCell>}
                <TableCell className="space-x-1">
                  {r.status === "Cancelled" ? <StatusBadge tone="slate">Cancelled</StatusBadge> : <StatusBadge tone="green">Saved</StatusBadge>}
                  {r.rdStatus && r.status !== "Cancelled" && <StatusBadge tone={r.rdStatus === "Collected" ? "orange" : "indigo"}>{r.rdStatus}</StatusBadge>}
                </TableCell>
              </TableRow>
            );
          })}
          {receipts.length === 0 && (
            <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">No receipts yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
      <p className="mt-3 text-xs text-muted-foreground">
        {showCommission ? "Commission shows for Admin and Super Admin only. " : ""}Only Admin and Super Admin can cancel a receipt; the number is never reused.
      </p>
    </div>
  );
}

async function OwnerPaid({ user }: { user: SessionUser }) {
  const scope = ownerScope(user);
  const [slips, openItems] = await Promise.all([
    db.ownerPaidSlip.findMany({
      where: { tenantId: user.tenantId, policy: scope },
      include: { policy: { select: { policyNumber: true } }, customer: { select: { name: true } }, closedByReceipt: { select: { receiptNo: true } } },
      orderBy: { createdAt: "desc" },
    }),
    // RD instalments that can still be marked owner-paid: unpaid, due by this month end.
    db.renewalItem.findMany({
      where: { tenantId: user.tenantId, status: { in: ["Due", "Overdue"] }, dueDate: { lt: addMonths(istToday(), 1) }, policy: { productType: "PoRd", ...scope } },
      include: { policy: { select: { policyNumber: true, customer: { select: { name: true } } } } },
      orderBy: { dueDate: "asc" },
    }),
  ]);
  const total = (st: OwnerPaidSlipStatus) => slips.filter((s) => s.status === st);
  const owes = total("CustomerOwes"), toReturn = total("CollectedReturnToOwner"), settled = total("Settled");
  const sumOf = (xs: typeof slips) => (xs.length ? sum(xs.map((s) => s.amount)) : ZERO);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <StatCard title="Owner paid – customer owes" value={`${owes.length} · ${fmtINR(sumOf(owes))}`} />
        <StatCard title="Collected – return to owner" value={`${toReturn.length} · ${fmtINR(sumOf(toReturn))}`} />
        <StatCard title="Settled" value={`${settled.length} · ${fmtINR(sumOf(settled))}`} />
        <StatCard title="Owner is owed now" value={fmtINR(sumOf([...owes, ...toReturn]))} sub="Owes + to return" highlight />
      </div>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 rounded-xl border bg-white p-4">
          <h2 className="mb-2 font-semibold">Owner-paid slips</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slip</TableHead><TableHead>RD account</TableHead><TableHead>Customer</TableHead><TableHead>Month</TableHead>
                <TableHead className="text-right">Amount</TableHead><TableHead>PO receipt no.</TableHead><TableHead>Customer receipt</TableHead><TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slips.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.slipNo}</TableCell>
                  <TableCell>{s.policy.policyNumber}</TableCell>
                  <TableCell>{s.customer.name}</TableCell>
                  <TableCell>{monthLabel(s.month)}</TableCell>
                  <TableCell className="text-right">{fmtINR(s.amount)}</TableCell>
                  <TableCell>{s.poReceiptNo}</TableCell>
                  <TableCell>{s.closedByReceipt ? <Link href={`/receipts/${s.closedByReceiptId}`} className="text-blue-700 hover:underline">{s.closedByReceipt.receiptNo}</Link> : "—"}</TableCell>
                  <TableCell><StatusBadge tone={SLIP_STATUS[s.status][1]}>{SLIP_STATUS[s.status][0]}</StatusBadge></TableCell>
                </TableRow>
              ))}
              {slips.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">No owner-paid slips.</TableCell></TableRow>}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Owner-paid slips are internal. A customer receipt is created only when the customer pays. Not counted as collections or income.
          </p>
        </div>
        <div className="w-80 shrink-0 space-y-4">
          <OwnerPaidForm items={openItems.map((i) => ({
            id: i.id,
            label: `${i.policy.policyNumber} · ${i.policy.customer.name} · ${monthLabel(i.dueDate)} · ${fmtINR(i.premiumAmount)}`,
          }))} />
          <ReturnToOwnerForm slips={toReturn.map((s) => ({ id: s.id, label: `${s.slipNo} · ${s.customer.name} · ${fmtINR(s.amount)}` }))} />
        </div>
      </div>
    </div>
  );
}
