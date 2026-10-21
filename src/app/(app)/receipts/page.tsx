import type { OwnerPaidSlipStatus } from "@prisma/client";
import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addMonths, fmtDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { companyStatus, DEPOSIT_WHERE, depositStatusSelect, nameLookup } from "@/lib/deposit-status";
import { ownerScope, userNames } from "@/lib/leads";
import { OWNER_PAYABLE } from "@/lib/dues";
import { MODE_LABEL } from "@/lib/payment-modes";
import { depositFilter, monthLabel, receiptTab, SLIP_STATUS } from "@/lib/lists";
import { fmtINR, sum, ZERO } from "@/lib/money";
import { seesAll } from "@/lib/permissions";
import { requirePermission, type SessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { OwnerPaidForm, ReturnToOwnerForm } from "./owner-paid-forms";

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ tab?: string; deposit?: string }> }) {
  const user = await requirePermission("Receipt.View");
  const sp = await searchParams;
  const tab = receiptTab(sp);
  const deposit = depositFilter(sp);

  return (
    <>
      <PageHeader title="Receipts" user={user} actions={<>
        <ExportButton report="receipts" user={user} params={{ deposit: deposit === "all" ? undefined : deposit }} />
        <Link href="/receipts/verification" className={buttonVariants({ variant: "outline" })}>PO verification</Link>
        <Link href="/direct-bills" className={buttonVariants({ variant: "outline" })}>Direct bills</Link>
        <Link href="/receipts/new" className={cn(buttonVariants(), "bg-brand-600 hover:bg-brand-700")}>New receipt</Link>
      </>} />
      <div className="mb-4 flex gap-1 border-b">
        {[["customer", "Customer receipts"], ["owner", "Owner-paid RD"]].map(([key, label]) => (
          <Link key={key} href={`/receipts?tab=${key}`}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === key ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {label}
          </Link>
        ))}
      </div>
      {tab === "customer" ? <CustomerReceipts tenantId={user.tenantId} createdById={seesAll(user.role) ? undefined : user.id} deposit={deposit} />
        : <OwnerPaid user={user} />}
    </>
  );
}

async function CustomerReceipts({ tenantId, createdById, deposit }: { tenantId: string; createdById?: string; deposit: "all" | "pending" | "paid" }) {
  const receipts = await db.receipt.findMany({
    where: { tenantId, ...(createdById && { createdById }), ...(deposit !== "all" && DEPOSIT_WHERE[deposit]) },
    include: {
      customer: { select: { name: true } },
      policy: { select: { partner: true, productName: true, policyNumber: true } },
      payment: { select: { id: true, paymentNo: true } },
      companyPayment: depositStatusSelect.companyPayment,
      poDepositLine: depositStatusSelect.poDepositLine,
    },
    orderBy: [{ receiptDate: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  const [accounts, users] = await Promise.all([db.account.findMany({ where: { tenantId }, select: { id: true, name: true } }), userNames(tenantId)]);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "—";
  const nameOf = nameLookup(users);

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Deposit status:</span>
        {([["all", "All"], ["pending", "Pending"], ["paid", "Paid"]] as const).map(([k, label]) => (
          <Link key={k} href={k === "all" ? "/receipts" : `/receipts?deposit=${k}`}
            className={cn("rounded-full px-3 py-0.5", deposit === k ? "bg-saffron-100 text-saffron-900" : "text-muted-foreground hover:bg-slate-100")}>{label}</Link>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Receipt no.</TableHead><TableHead>Bill date</TableHead><TableHead>Txn date</TableHead><TableHead>Customer</TableHead><TableHead>For</TableHead>
            <TableHead>Mode</TableHead><TableHead>Account</TableHead><TableHead className="text-right">Amount</TableHead>
            <TableHead>Collected by</TableHead><TableHead>Status</TableHead><TableHead>Deposit status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {receipts.map((r) => {
            const dep = r.policy && r.status !== "Cancelled" ? companyStatus(r, r.policy.partner, nameOf) : null;
            return (
              <TableRow key={r.id} className={cn(r.status === "Cancelled" && "text-muted-foreground")}>
                <TableCell>
                  <Link href={`/receipts/${r.id}`} className="text-brand-700 hover:underline">{r.receiptNo}</Link>
                  {r.payment && <Link href={`/payments/${r.payment.id}`} className="block text-xs text-muted-foreground hover:underline">{r.payment.paymentNo}</Link>}
                </TableCell>
                <TableCell>{fmtDate(r.receiptDate)}</TableCell>
                <TableCell>{fmtDate(r.txnDate)}</TableCell>
                <TableCell>{r.customer.name}</TableCell>
                <TableCell>{r.policy ? `${r.policy.partner === "Post Office" ? r.policy.policyNumber : `${r.policy.partner} ${r.policy.productName}`}` : r.notes}{r.ownerPaid && " (owner-paid)"}</TableCell>
                <TableCell>{MODE_LABEL[r.mode]}{r.bankName && <span className="block text-xs text-muted-foreground">{r.bankName}</span>}</TableCell>
                <TableCell>{accountName(r.accountId)}</TableCell>
                <TableCell className="text-right">{fmtINR(r.amount)}</TableCell>
                <TableCell>{nameOf(r.createdById)}</TableCell>
                <TableCell className="space-x-1">
                  {r.status === "Cancelled" ? <StatusBadge tone="slate">Cancelled</StatusBadge> : <StatusBadge tone="green">Saved</StatusBadge>}
                  {r.rdStatus && r.status !== "Cancelled" && <StatusBadge tone={r.rdStatus === "Collected" ? "orange" : "indigo"}>{r.rdStatus}</StatusBadge>}
                </TableCell>
                <TableCell className="text-sm">
                  {dep ? <span className={dep.state === "paid" ? "text-green-700" : "text-saffron-800"}>{dep.text}</span> : "—"}
                </TableCell>
              </TableRow>
            );
          })}
          {receipts.length === 0 && (
            <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">No receipts yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
      <p className="mt-3 text-xs text-muted-foreground">
        Only Admin and Super Admin can cancel a receipt; the number is never reused.
      </p>
    </div>
  );
}

async function OwnerPaid({ user }: { user: SessionUser }) {
  const scope = ownerScope(user);
  const [slips, openItems] = await Promise.all([
    db.ownerPaidSlip.findMany({
      where: { tenantId: user.tenantId, policy: scope },
      include: { policy: { select: { policyNumber: true, partner: true } }, customer: { select: { name: true } }, closedByReceipt: { select: { receiptNo: true } }, renewalItem: { select: { billNo: true, dueDate: true } } },
      orderBy: { createdAt: "desc" },
    }),
    // Bills that can still be marked owner-paid: unpaid, due within a month (every billed product except MF).
    db.renewalItem.findMany({
      where: { tenantId: user.tenantId, status: { in: ["Due", "Overdue"] }, dueDate: { lt: addMonths(istToday(), 1) }, policy: { ...OWNER_PAYABLE, ...scope } },
      include: { policy: { select: { policyNumber: true, partner: true, frequency: true, customer: { select: { name: true } } } } },
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
          <h2 className="mb-2 font-semibold">Owner-paid slips · billed products</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slip</TableHead><TableHead>Policy / account</TableHead><TableHead>Customer</TableHead><TableHead>Bill</TableHead>
                <TableHead className="text-right">Amount</TableHead><TableHead>Reference no.</TableHead><TableHead>Customer receipt</TableHead><TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slips.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.slipNo}</TableCell>
                  <TableCell>{s.policy.policyNumber}{s.policy.partner !== "Post Office" && <span className="text-xs text-muted-foreground"> ({s.policy.partner})</span>}</TableCell>
                  <TableCell>{s.customer.name}</TableCell>
                  <TableCell>{s.renewalItem ? <>{s.renewalItem.billNo} <span className="text-xs text-muted-foreground">{fmtDate(s.renewalItem.dueDate)}</span></> : monthLabel(s.month)}</TableCell>
                  <TableCell className="text-right">{fmtINR(s.amount)}</TableCell>
                  <TableCell>{s.poReceiptNo}</TableCell>
                  <TableCell>{s.closedByReceipt ? <Link href={`/receipts/${s.closedByReceiptId}`} className="text-brand-700 hover:underline">{s.closedByReceipt.receiptNo}</Link> : "—"}</TableCell>
                  <TableCell><StatusBadge tone={SLIP_STATUS[s.status][1]}>{SLIP_STATUS[s.status][0]}</StatusBadge></TableCell>
                </TableRow>
              ))}
              {slips.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">No owner-paid slips.</TableCell></TableRow>}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Owner-paid slips are internal. A customer receipt is created only when the customer pays. Not counted as collections or income.
            Allowed for every product with bills (RD, SSA, PPF, LIC, SBI Life, health and general insurance); not for one-time deposits or mutual funds.
          </p>
        </div>
        <div className="w-80 shrink-0 space-y-4">
          <OwnerPaidForm items={openItems.map((i) => ({
            id: i.id,
            label: `${i.billNo} · ${i.policy.policyNumber}${i.policy.partner === "Post Office" ? "" : ` (${i.policy.partner})`} · ${i.policy.customer.name} · ${i.policy.frequency === "Monthly" ? monthLabel(i.dueDate) : fmtDate(i.dueDate)} · ${fmtINR(i.premiumAmount)}`,
          }))} />
          <ReturnToOwnerForm slips={toReturn.map((s) => ({ id: s.id, label: `${s.slipNo} · ${s.customer.name} · ${fmtINR(s.amount)}`, amount: s.amount.toFixed(2) }))} />
        </div>
      </div>
    </div>
  );
}
