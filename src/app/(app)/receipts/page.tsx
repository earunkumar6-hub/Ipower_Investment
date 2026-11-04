import type { OwnerPaidSlipStatus } from "@prisma/client";
import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addMonths, fmtDate, istToday } from "@/lib/dates";
import { accountLabel } from "@/lib/accounts";
import { db } from "@/lib/db";
import { companyStatus, depositStatusSelect, nameLookup } from "@/lib/deposit-status";
import { ownerScope, userNames } from "@/lib/leads";
import { OWNER_PAYABLE } from "@/lib/dues";
import { MODE_LABEL } from "@/lib/payment-modes";
import { monthLabel, RECEIPT_TABS, receiptFilter, receiptTab, type ReceiptTab, SLIP_STATUS, type Params } from "@/lib/lists";
import { fmtINR, sum, ZERO } from "@/lib/money";
import { requirePermission, type SessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { OwnerPaidForm, ReturnToOwnerForm } from "./owner-paid-forms";
import { ReceiptFilters } from "./receipt-filters";

type Filter = ReturnType<typeof receiptFilter>;
/** /receipts with the current filters, changed by `patch` (an undefined value drops the key). */
const href = (params: Params, patch: Params) =>
  `/receipts?${new URLSearchParams(Object.entries({ ...params, ...patch }).filter((e): e is [string, string] => !!e[1]))}`;

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requirePermission("Receipt.View");
  const sp = await searchParams;
  const tab = receiptTab(sp);
  const f = receiptFilter(user, sp);
  const [counts, accounts, groups] = await Promise.all([
    Promise.all([
      db.receipt.count({ where: f.receiptWhere }),
      db.ownerPaidSlip.count({ where: f.slipWhere }),
      db.payment.count({ where: f.paymentWhere("Combined") }),
      db.payment.count({ where: f.paymentWhere("BillGroup") }),
    ]),
    db.account.findMany({ where: { tenantId: user.tenantId, type: { in: ["Cash", "Bank"] } }, orderBy: [{ type: "asc" }, { active: "desc" }, { name: "asc" }] }),
    db.billGroup.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const count: Record<ReceiptTab, number> = { customer: counts[0], owner: counts[1], combined: counts[2], family: counts[3] };

  return (
    <>
      <PageHeader title="Receipts" user={user} actions={<>
        <ExportButton report="receipts" user={user} params={f.params} />
        <Link href="/receipts/verification" className={buttonVariants({ variant: "outline" })}>PO verification</Link>
        <Link href="/direct-bills" className={buttonVariants({ variant: "outline" })}>Direct bills</Link>
        <Link href="/receipts/new" className={cn(buttonVariants(), "bg-brand-600 hover:bg-brand-700")}>New receipt</Link>
      </>} />
      <ReceiptFilters f={f} tab={tab} groups={groups} accounts={accounts.map((a) => ({ id: a.id, label: `${accountLabel(a)}${a.active ? "" : " (switched off)"}` }))} />
      <div className="mb-4 flex gap-1 border-b">
        {RECEIPT_TABS.map(([key, label]) => [key, label, count[key]] as const).map(([key, label, n]) => (
          <Link key={key} href={href(f.params, { tab: key })}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === key ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {label} <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-xs text-slate-700">{n}</span>
          </Link>
        ))}
      </div>
      {tab === "customer" ? <CustomerReceipts tenantId={user.tenantId} f={f} total={count.customer} />
        : tab === "owner" ? <OwnerPaid user={user} f={f} />
        : <GroupedReceipts tenantId={user.tenantId} f={f} kind={tab === "combined" ? "Combined" : "BillGroup"} total={count[tab]} />}
    </>
  );
}

async function CustomerReceipts({ tenantId, f, total }: { tenantId: string; f: Filter; total: number }) {
  const deposit = f.deposit;
  const receipts = await db.receipt.findMany({
    where: f.receiptWhere,
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
  const [accounts, users] = await Promise.all([db.account.findMany({ where: { tenantId }, select: { id: true, type: true, name: true, bankName: true, last4: true } }), userNames(tenantId)]);
  // Every account, switched off ones too: old receipts keep showing where the money went.
  const accountName = (id: string) => { const a = accounts.find((x) => x.id === id); return a ? accountLabel(a) : "—"; };
  const nameOf = nameLookup(users);

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Deposit status:</span>
        {([["all", "All"], ["pending", "Pending"], ["paid", "Paid"]] as const).map(([k, label]) => (
          <Link key={k} href={href(f.params, { deposit: k === "all" ? undefined : k })}
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
            <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">{f.active || deposit !== "all" ? "No receipts match these filters." : "No receipts yet."}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
      <p className="mt-3 text-xs text-muted-foreground">
        {total > receipts.length && `Showing the latest ${receipts.length} of ${total}; narrow the filters or export to see all. `}
        Only Admin and Super Admin can cancel a receipt; the number is never reused.
      </p>
    </div>
  );
}

async function OwnerPaid({ user, f }: { user: SessionUser; f: Filter }) {
  const scope = ownerScope(user);
  const [slips, openItems] = await Promise.all([
    db.ownerPaidSlip.findMany({
      where: f.slipWhere,
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
            {(f.mode || f.account || f.deposit !== "all") && " Mode, account and deposit status filters don't apply to owner-paid slips."}
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

/** Combined and Family grouped (bill-group) receipts: one row per PAY- receipt, made out to the payer. */
async function GroupedReceipts({ tenantId, f, kind, total }: { tenantId: string; f: Filter; kind: "Combined" | "BillGroup"; total: number }) {
  const [payments, accounts, users, groupsWithPolicies] = await Promise.all([
    db.payment.findMany({
      where: f.paymentWhere(kind),
      include: { billGroup: { select: { id: true, name: true } }, receipts: { select: { accountId: true, customer: { select: { name: true } } } } },
      orderBy: [{ receiptDate: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    db.account.findMany({ where: { tenantId }, select: { id: true, type: true, name: true, bankName: true, last4: true } }),
    userNames(tenantId),
    kind === "BillGroup"
      ? db.billGroup.findMany({ where: { tenantId, members: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);
  const accountName = (id?: string) => { const a = accounts.find((x) => x.id === id); return a ? accountLabel(a) : "—"; };
  const nameOf = nameLookup(users);
  const family = kind === "BillGroup";
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {family ? "Receipts for saved bill groups: every member's bill paid in one receipt." : "Bills ticked across customers, paid by one person in one receipt."}
        </span>
        {family
          ? (
            <div className="flex items-center gap-2">
              {groupsWithPolicies.length > 0 ? (
                // Plain GET form: opens /receipts/new?groupId=… for the group picked.
                <form action="/receipts/new" className="flex items-center gap-2">
                  <NativeSelect name="groupId" size="sm" required aria-label="Bill group" defaultValue="">
                    <NativeSelectOption value="" disabled></NativeSelectOption>
                    {groupsWithPolicies.map((g) => <NativeSelectOption key={g.id} value={g.id}>{g.name}</NativeSelectOption>)}
                  </NativeSelect>
                  <Button type="submit" size="sm" className="bg-brand-600 hover:bg-brand-700">New family receipt</Button>
                </form>
              ) : (
                <span className="text-xs text-muted-foreground">Add policies to a bill group to take its receipt.</span>
              )}
              <Link href="/receipts/groups" className={buttonVariants({ size: "sm", variant: "outline" })}>Bill groups</Link>
            </div>
          )
          : <Link href="/receipts/combined/new" className={cn(buttonVariants({ size: "sm" }), "bg-brand-600 hover:bg-brand-700")}>New combined receipt</Link>}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Receipt no.</TableHead><TableHead>Bill date</TableHead>{family && <TableHead>Bill group</TableHead>}<TableHead>Paid by</TableHead><TableHead>Customers</TableHead>
            <TableHead className="text-right">Bills</TableHead><TableHead>Mode</TableHead><TableHead>Account</TableHead><TableHead className="text-right">Amount</TableHead>
            {!family && <TableHead>PO receipt no.</TableHead>}<TableHead>Collected by</TableHead><TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((p) => {
            const names = [...new Set(p.receipts.map((r) => r.customer.name))];
            return (
              <TableRow key={p.id} className={cn(p.status === "Cancelled" && "text-muted-foreground")}>
                <TableCell><Link href={`/payments/${p.id}`} className="text-brand-700 hover:underline">{p.paymentNo}</Link></TableCell>
                <TableCell>{fmtDate(p.receiptDate)}</TableCell>
                {family && <TableCell>{p.billGroup ? <Link href={`/receipts/groups/${p.billGroup.id}`} className="hover:underline">{p.billGroup.name}</Link> : "—"}</TableCell>}
                <TableCell>{p.payerName}<span className="block text-xs text-muted-foreground">{p.payerMobile}</span></TableCell>
                <TableCell className="max-w-48 whitespace-normal text-sm">{names.slice(0, 3).join(", ")}{names.length > 3 && ` +${names.length - 3}`}</TableCell>
                <TableCell className="text-right">{p.receipts.length}</TableCell>
                <TableCell>{MODE_LABEL[p.mode]}{p.bankName && <span className="block text-xs text-muted-foreground">{p.bankName}</span>}</TableCell>
                <TableCell>{accountName(p.receipts[0]?.accountId)}</TableCell>
                <TableCell className="text-right">{fmtINR(p.amount)}</TableCell>
                {!family && <TableCell>{p.poReceiptNo ?? "—"}</TableCell>}
                <TableCell>{nameOf(p.createdById)}</TableCell>
                <TableCell>{p.status === "Cancelled" ? <StatusBadge tone="slate">Cancelled</StatusBadge> : <StatusBadge tone="green">Saved</StatusBadge>}</TableCell>
              </TableRow>
            );
          })}
          {payments.length === 0 && (
            <TableRow><TableCell colSpan={12} className="py-8 text-center text-muted-foreground">{f.active ? "No receipts match these filters." : "No receipts yet."}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
      <p className="mt-3 text-xs text-muted-foreground">
        {total > payments.length && `Showing the latest ${payments.length} of ${total}; narrow the filters or export to see all. `}
        Each bill keeps its own receipt line under its customer. Only Admin and Super Admin can cancel; the whole receipt is cancelled together.
        {f.deposit !== "all" && " The deposit status filter applies to customer receipts only."}
      </p>
    </div>
  );
}
