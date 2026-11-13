import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { nameLookup } from "@/lib/deposit-status";
import { maskMobile } from "@/lib/lead-labels";
import { userNames } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { modeLabel } from "@/lib/payment-modes";
import { seesAllRecords } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";

export default async function DirectBillsPage() {
  const user = await requirePermission("Receipt.View");
  const [bills, users] = await Promise.all([
    db.directBill.findMany({
      where: { tenantId: user.tenantId, ...(!seesAllRecords(user.role) && { createdById: user.id }) },
      include: { customer: { select: { id: true, name: true } } },
      orderBy: [{ billDate: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    userNames(user.tenantId),
  ]);
  const nameOf = nameLookup(users);

  return (
    <>
      <PageHeader title="Direct bills" user={user} actions={<>
        <Link href="/receipts" className={buttonVariants({ variant: "outline" })}>Receipts</Link>
        <Link href="/direct-bills/new" className={cn(buttonVariants(), "bg-brand-600 hover:bg-brand-700")}>New direct bill</Link>
      </>} />
      <div className="rounded-xl border bg-white p-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bill no.</TableHead><TableHead>Bill date</TableHead><TableHead>Paid by</TableHead><TableHead>Purpose</TableHead>
              <TableHead>Mode</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Received by</TableHead><TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bills.map((b) => (
              <TableRow key={b.id} className={cn(b.status === "Cancelled" && "text-muted-foreground")}>
                <TableCell><Link href={`/direct-bills/${b.id}`} className="text-brand-700 hover:underline">{b.billNo}</Link></TableCell>
                <TableCell>{fmtDate(b.billDate)}</TableCell>
                <TableCell>
                  {b.payerName} <span className="text-xs text-muted-foreground">{maskMobile(b.payerMobile)}</span>
                  {b.customer && <span className="block text-xs text-muted-foreground">Customer: {b.customer.name}</span>}
                </TableCell>
                <TableCell>{b.purpose}</TableCell>
                <TableCell>{modeLabel(b)}{b.bankName && <span className="block text-xs text-muted-foreground">{b.bankName}</span>}</TableCell>
                <TableCell className="text-right">{fmtINR(b.amount)}</TableCell>
                <TableCell>{nameOf(b.createdById)}</TableCell>
                <TableCell>
                  <StatusBadge tone={b.status === "Cancelled" ? "slate" : "green"}>{b.status}</StatusBadge>
                  {b.status === "Cancelled" && <span className="block text-xs">by {nameOf(b.cancelledById)}{b.cancelledAt && `, ${fmtDate(b.cancelledAt)}`}</span>}
                </TableCell>
              </TableRow>
            ))}
            {bills.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No direct bills yet</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
