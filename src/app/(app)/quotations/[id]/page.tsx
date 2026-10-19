import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtDateTime, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn, userNames } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { AcceptButton, CreateProposalButton } from "./quotation-actions";

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("Quote.View");
  const { id } = await params;
  const q = await db.quotation.findFirst({
    where: { id, tenantId: user.tenantId },
    include: { items: { include: { proposal: true } } },
  });
  if (!q || !canActOn(user, q.ownerId)) notFound();
  const owner = (await userNames(user.tenantId)).find((u) => u.id === q.ownerId)?.name ?? "—";
  const accepted = q.status === "Accepted";
  const expired = q.validUpto < istToday();

  return (
    <>
      <PageHeader title="Quotations" user={user} actions={
        <Link href="/quotations/new" className={cn(buttonVariants(), "bg-brand-600 hover:bg-brand-700")}>New quotation</Link>
      } />
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-4 rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Quotation {q.quoteNo} · {q.customerName}</h2>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Customer</dt><dd>{q.customerName} · {q.mobile}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Valid till</dt><dd>{fmtDate(q.validUpto)}{expired && !accepted && <span className="text-destructive"> (expired)</span>}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Prepared by</dt><dd>{owner}</dd></div>
          </dl>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead><TableHead>Plan</TableHead><TableHead className="text-right">Sum insured / cover</TableHead>
                <TableHead className="text-right">Premium</TableHead><TableHead className="text-right">GST 18%</TableHead><TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.category}</TableCell>
                  <TableCell>{i.insurer} – {i.productName}</TableCell>
                  <TableCell className="text-right">{i.sumInsured ? fmtINR(i.sumInsured) : "—"}</TableCell>
                  <TableCell className="text-right">{fmtINR(i.premium)}</TableCell>
                  <TableCell className="text-right">{fmtINR(i.gstAmount)}</TableCell>
                  <TableCell className="text-right">{fmtINR(i.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="text-right">Total</TableCell>
                <TableCell className="text-right">{fmtINR(q.subtotal)}</TableCell>
                <TableCell className="text-right">{fmtINR(q.gstTotal)}</TableCell>
                <TableCell className="text-right font-semibold">{fmtINR(q.total)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <div className="flex gap-2">
            <a href={`/api/quotations/${q.id}/pdf`} className={buttonVariants({ variant: "outline" })}>Download PDF</a>
            {!accepted && <AcceptButton quotationId={q.id} disabled={expired} />}
          </div>
        </div>

        <aside className="w-80 shrink-0 rounded-xl border bg-white p-4">
          <h2 className="mb-3 font-semibold">Customer decision</h2>
          <ol className="space-y-3 text-sm">
            <li className="flex justify-between gap-2">
              <span>Quotation prepared</span>
              <span className="text-right text-xs text-muted-foreground"><StatusBadge tone="green">Done</StatusBadge><br />{fmtDateTime(q.createdAt)}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span>Customer accepted</span>
              <span className="text-right text-xs text-muted-foreground">
                {accepted ? <><StatusBadge tone="green">Accepted</StatusBadge><br />{q.acceptedAt && fmtDateTime(q.acceptedAt)}</> : <StatusBadge tone="slate">Waiting</StatusBadge>}
              </span>
            </li>
            {q.items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2">
                <span>Proposal · {i.insurer}</span>
                {i.proposal ? (
                  <Link href={`/proposals/${i.proposal.id}`} className="text-brand-700 hover:underline">{i.proposal.proposalNo}</Link>
                ) : accepted ? (
                  <CreateProposalButton quotationItemId={i.id} />
                ) : (
                  <StatusBadge tone="slate">After acceptance</StatusBadge>
                )}
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-muted-foreground">Lead → Quotation accepted → Proposal → Partner / Customer → Receipt</p>
        </aside>
      </div>
    </>
  );
}
