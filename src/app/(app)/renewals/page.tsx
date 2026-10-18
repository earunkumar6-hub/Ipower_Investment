import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtDateTime, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { RENEWAL_TABS as TABS, RENEWAL_TYPES as TYPES, renewalFilter } from "@/lib/lists";
import { fmtINR, sum, ZERO } from "@/lib/money";
import { refreshOverdue } from "@/lib/renewals";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { RenewalRowActions } from "./row-actions";

type Search = { tab?: string; type?: string; within?: string };

export default async function RenewalsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("Renewal.View");
  const sp = await searchParams;
  const today = istToday();
  await refreshOverdue(user.tenantId, today);
  const { tab, type, within, where, orderBy } = renewalFilter(user, sp, today);
  const items = await db.renewalItem.findMany({
    where,
    include: { policy: { include: { customer: { select: { id: true, name: true } } } } },
    orderBy,
    take: 200,
  });
  const receiptNos = new Map(
    (await db.receipt.findMany({ where: { id: { in: items.map((i) => i.paidReceiptId).filter((x): x is string => !!x) } }, select: { id: true, receiptNo: true } }))
      .map((r) => [r.id, r.receiptNo]),
  );
  const total = items.length ? sum(items.map((i) => i.premiumAmount)) : ZERO;
  const link = (o: Partial<Search>) => `/renewals?${new URLSearchParams({ tab, type, ...(sp.within && { within: sp.within }), ...o })}`;

  return (
    <>
      <PageHeader title="Renewals" user={user} actions={<ExportButton report="renewals" user={user} params={{ tab, type, within: sp.within }} />} />
      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex items-center justify-between border-b">
          <div className="flex gap-1">
            {TABS.map(([k, label]) => (
              <Link key={k} href={link({ tab: k })}
                className={cn("-mb-px border-b-2 px-3 pb-2 text-sm", tab === k ? "border-blue-600 font-medium text-blue-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {label}
              </Link>
            ))}
          </div>
          <div className="flex gap-2 pb-2 text-sm">
            {TYPES.map(([k, label]) => (
              <Link key={k} href={link({ type: k })} className={cn("rounded-full px-3 py-0.5", type === k ? "bg-blue-100 text-blue-800" : "text-muted-foreground hover:bg-slate-100")}>{label}</Link>
            ))}
          </div>
        </div>
        <p className="mb-2 text-sm text-muted-foreground">
          {items.length} {tab === "due" ? `due in the next ${within} days` : tab === "overdue" ? "overdue" : "paid in the last 30 days"} · {fmtINR(total)}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Policy / account</TableHead><TableHead>Due</TableHead>
              <TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead>
              <TableHead>{tab === "paid" ? "Paid · receipt" : "Last reminder"}</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => {
              const daysOver = Math.round((today.getTime() - i.dueDate.getTime()) / 86_400_000);
              const p = i.policy;
              return (
                <TableRow key={i.id}>
                  <TableCell><Link href={`/customers/${p.customer.id}`} className="text-blue-700 hover:underline">{p.customer.name}</Link></TableCell>
                  <TableCell>{p.productType === "PoRd" ? "Post office RD" : `${p.partner} ${p.productName}`}</TableCell>
                  <TableCell>{p.policyNumber}</TableCell>
                  <TableCell>{fmtDate(i.dueDate)}</TableCell>
                  <TableCell className="text-right">{fmtINR(i.premiumAmount)}</TableCell>
                  <TableCell>
                    {i.status === "Overdue" ? <StatusBadge tone="red">{daysOver} days overdue</StatusBadge>
                      : i.status === "Paid" ? <StatusBadge tone="green">Paid</StatusBadge>
                      : <StatusBadge tone="orange">{daysOver === 0 ? "Due today" : `Due in ${-daysOver} days`}</StatusBadge>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {tab === "paid"
                      ? <>{i.paidOn && fmtDate(i.paidOn)} · {i.paidReceiptId ? <Link href={`/receipts/${i.paidReceiptId}`} className="text-blue-700 hover:underline">{receiptNos.get(i.paidReceiptId)}</Link> : "owner paid"}</>
                      : i.lastReminderAt ? fmtDateTime(i.lastReminderAt) : "—"}
                  </TableCell>
                  <TableCell className="text-right">{tab !== "paid" && <RenewalRowActions renewalItemId={i.id} customerId={p.customer.id} />}</TableCell>
                </TableRow>
              );
            })}
            {items.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">Nothing here.</TableCell></TableRow>}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">Reminders are mocked: &quot;Send reminder&quot; writes the WhatsApp message to Sent messages instead of sending it.</p>
      </div>
    </>
  );
}
