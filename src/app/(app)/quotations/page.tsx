import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { ListSearch } from "@/components/list-search";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { ownerScope } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { quotationStatus } from "@/lib/quotation";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission("Quote.View");
  const q = (await searchParams).q?.trim() || undefined;
  const quotations = await db.quotation.findMany({
    where: {
      tenantId: user.tenantId,
      ...ownerScope(user),
      deletedAt: null,
      ...(q && {
        AND: [{
          OR: [
            { mobile: { contains: q } },
            { customerName: { contains: q, mode: "insensitive" as const } },
            { quoteNo: { contains: q, mode: "insensitive" as const } },
          ],
        }],
      }),
    },
    include: { items: { include: { proposal: { select: { status: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <>
      <PageHeader title="Quotations" user={user} actions={<>
        <ExportButton report="quotations" user={user} />
        <Link href="/quotations/new" className={cn(buttonVariants(), "bg-brand-600 hover:bg-brand-700")}>New quotation</Link>
      </>} />
      <div className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 font-semibold">Recent quotations</h2>
        <ListSearch q={q} placeholder="Mobile, customer name or quote no." />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No.</TableHead><TableHead>Customer</TableHead><TableHead>Products</TableHead>
              <TableHead className="text-right">Total</TableHead><TableHead>Valid till</TableHead><TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotations.map((q) => {
              const [label, tone] = quotationStatus(q);
              return (
                <TableRow key={q.id}>
                  <TableCell><Link href={`/quotations/${q.id}`} className="text-brand-700 hover:underline">{q.quoteNo}</Link></TableCell>
                  <TableCell>{q.customerName}</TableCell>
                  <TableCell className="whitespace-normal">{q.items.map((i) => `${i.insurer} ${i.productName}`).join(", ")}</TableCell>
                  <TableCell className="text-right">{q.total.gt(0) ? fmtINR(q.total) : "—"}</TableCell>
                  <TableCell>{fmtDate(q.validUpto)}</TableCell>
                  <TableCell><StatusBadge tone={tone}>{label}</StatusBadge></TableCell>
                </TableRow>
              );
            })}
            {quotations.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{q ? `No quotations match "${q}".` : "No quotations yet."}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
