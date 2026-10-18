import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { ownerScope } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";

export default async function QuotationsPage() {
  const user = await requirePermission("Quote.View");
  const quotations = await db.quotation.findMany({
    where: { tenantId: user.tenantId, ...ownerScope(user) },
    include: { items: true, proposals: { select: { status: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <>
      <PageHeader title="Quotations" user={user} actions={<>
        <ExportButton report="quotations" user={user} />
        <Link href="/quotations/new" className={cn(buttonVariants(), "bg-blue-600 hover:bg-blue-700")}>New quotation</Link>
      </>} />
      <div className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 font-semibold">Recent quotations</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No.</TableHead><TableHead>Customer</TableHead><TableHead>Products</TableHead>
              <TableHead className="text-right">Total</TableHead><TableHead>Valid till</TableHead><TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotations.map((q) => {
              const converted = q.proposals.some((p) => p.status === "Issued");
              return (
                <TableRow key={q.id}>
                  <TableCell><Link href={`/quotations/${q.id}`} className="text-blue-700 hover:underline">{q.quoteNo}</Link></TableCell>
                  <TableCell>{q.customerName}</TableCell>
                  <TableCell>{q.items.map((i) => i.category).join(", ")}</TableCell>
                  <TableCell className="text-right">{fmtINR(q.total)}</TableCell>
                  <TableCell>{fmtDate(q.validUpto)}</TableCell>
                  <TableCell>
                    {converted ? <StatusBadge tone="green">Converted</StatusBadge>
                      : q.status === "Accepted" ? <StatusBadge tone="indigo">Accepted</StatusBadge>
                      : <StatusBadge tone="slate">Draft</StatusBadge>}
                  </TableCell>
                </TableRow>
              );
            })}
            {quotations.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No quotations yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
