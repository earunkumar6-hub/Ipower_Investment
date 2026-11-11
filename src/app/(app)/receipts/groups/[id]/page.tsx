import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { fmtINR } from "@/lib/money";
import { hasPermission, seesAll } from "@/lib/permissions";
import { PAY_MODE_LABEL } from "@/lib/products";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { AddMemberForm, FindPoliciesToAdd, RemoveMemberButton } from "../group-forms";

export default async function BillGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("Receipt.View");
  const { id } = await params;
  const g = await db.billGroup.findFirst({
    where: { id, tenantId: user.tenantId },
    include: {
      members: { include: { policy: { include: { customer: { select: { id: true, name: true, cifNo: true } } } } }, orderBy: { addedAt: "asc" } },
      payments: { where: seesAll(user.role) ? {} : { createdById: user.id }, orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!g) notFound();
  const canManage = hasPermission(user.role, "BillGroup.Manage");

  return (
    <>
      <PageHeader title={`Bill group · ${g.name}`} user={user} actions={<>
        <Link href="/receipts/groups" className={buttonVariants({ variant: "ghost" })}>All bill groups</Link>
        {g.members.length > 0 && <Link href={`/receipts/new?groupId=${g.id}`} className={cn(buttonVariants(), "bg-brand-600 hover:bg-brand-700")}>New receipt for this group</Link>}
      </>} />
      <div className="max-w-5xl space-y-4">
        <div className="rounded-xl border bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">Usually paid by: {[g.contactName, g.contactMobile].filter(Boolean).join(" · ") || "—"}</p>
            {canManage && <AddMemberForm billGroupId={g.id} />}
          </div>
          {canManage && <div className="mb-3"><FindPoliciesToAdd billGroupId={g.id} /></div>}
          <Table>
            <TableHeader>
              <TableRow><TableHead>Customer</TableHead><TableHead>Policy / account</TableHead><TableHead>Product</TableHead><TableHead>Pay mode</TableHead><TableHead className="text-right">Premium</TableHead><TableHead>Status</TableHead>{canManage && <TableHead />}</TableRow>
            </TableHeader>
            <TableBody>
              {g.members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell><Link href={`/customers/${m.policy.customer.id}`} className="text-brand-700 hover:underline">{m.policy.customer.name}</Link></TableCell>                  <TableCell>{m.policy.policyNumber}</TableCell>
                  <TableCell>{m.policy.partner} {m.policy.productName}</TableCell>
                  <TableCell>{PAY_MODE_LABEL[m.policy.frequency]}</TableCell>
                  <TableCell className="text-right">{fmtINR(m.policy.premiumAmount)}</TableCell>
                  <TableCell><StatusBadge tone={m.policy.status === "Active" ? "green" : "slate"}>{m.policy.status}</StatusBadge></TableCell>
                  {canManage && <TableCell className="text-right"><RemoveMemberButton memberId={m.id} policyNumber={m.policy.policyNumber} /></TableCell>}
                </TableRow>
              ))}
              {g.members.length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No policies yet{canManage ? " – find them above, or add one by its number." : "."}</TableCell></TableRow>}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">Closed or matured policies stay listed but get no more bills.</p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <h2 className="mb-2 font-semibold">Receipts for this group</h2>
          <Table>
            <TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Bill date</TableHead><TableHead>Paid by</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {g.payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell><Link href={`/payments/${p.id}`} className="text-brand-700 hover:underline">{p.paymentNo}</Link></TableCell>
                  <TableCell>{fmtDate(p.receiptDate)}</TableCell>
                  <TableCell>{p.payerName}</TableCell>
                  <TableCell className="text-right">{fmtINR(p.amount)}</TableCell>
                  <TableCell><StatusBadge tone={p.status === "Cancelled" ? "slate" : "green"}>{p.status}</StatusBadge></TableCell>
                </TableRow>
              ))}
              {g.payments.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No receipts yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}
