import Link from "next/link";
import { notFound } from "next/navigation";
import { AttachmentsPanel } from "@/components/attachments-panel";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { ATTACHMENT_KINDS, attachmentRows } from "@/lib/attachments";
import { fmtDate, fmtDateTime, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn, userNames } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { hasPermission } from "@/lib/permissions";
import { PAY_MODE_LABEL } from "@/lib/products";
import { quotationStatus } from "@/lib/quotation";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { QuoteItemsTable, ReasonButton } from "./quotation-actions";

export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("Quote.View");
  const { id } = await params;
  const q = await db.quotation.findFirst({
    where: { id, tenantId: user.tenantId },
    include: { items: { include: { proposal: true } } },
  });
  if (!q || !canActOn(user, q.ownerId)) notFound();
  const users = await userNames(user.tenantId);
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? "—";
  const files = await attachmentRows(user, "Quotation", q.id);
  const deleted = !!q.deletedAt;
  const anyProposal = q.items.some((i) => i.proposal);
  const expired = q.validUpto < istToday() && q.status === "Draft";
  const [statusLabel, statusTone] = quotationStatus(q);
  const canDecide = !deleted && q.status !== "NotAccepted" && !expired && hasPermission(user.role, "Proposal.Create");

  return (
    <>
      <PageHeader title="Quotations" user={user} actions={
        <Link href="/quotations/new" className={cn(buttonVariants(), "bg-brand-600 hover:bg-brand-700")}>New quotation</Link>
      } />
      {deleted && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          Deleted by {nameOf(q.deletedById)} on {fmtDateTime(q.deletedAt!)}: {q.deleteReason}
        </div>
      )}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-4 rounded-xl border bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Quotation {q.quoteNo} · {q.customerName}</h2>
            <StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Customer</dt><dd>{q.customerName} · {q.mobile}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Valid till</dt><dd>{fmtDate(q.validUpto)}{expired && <span className="text-destructive"> (expired)</span>}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Prepared by</dt><dd>{nameOf(q.ownerId)}</dd></div>
          </dl>
          {q.notAcceptedReason && <p className="text-sm text-orange-700">Not accepted: {q.notAcceptedReason}</p>}
          <QuoteItemsTable
            quotationId={q.id}
            canDecide={canDecide}
            totals={{ premium: fmtINR(q.subtotal), gst: fmtINR(q.gstTotal), total: fmtINR(q.total) }}
            items={q.items.map((i) => ({
              id: i.id, category: i.category, plan: `${i.insurer} – ${i.productName}`, cover: i.sumInsured ? fmtINR(i.sumInsured) : "—", payMode: PAY_MODE_LABEL[i.payMode],
              premium: fmtINR(i.premium), gst: fmtINR(i.gstAmount), total: fmtINR(i.total), decision: i.decision,
              proposal: i.proposal && { id: i.proposal.id, no: i.proposal.proposalNo },
            }))}
          />
          <div className="flex flex-wrap gap-2">
            <a href={`/api/quotations/${q.id}/pdf`} className={buttonVariants({ variant: "outline" })}>Export PDF</a>
            <a href={`/api/quotations/${q.id}/pdf?format=png`} className={buttonVariants({ variant: "outline" })}>Export image</a>
            {!deleted && !anyProposal && q.status !== "NotAccepted" && <ReasonButton quotationId={q.id} kind="notAccepted" />}
            {!deleted && !anyProposal && <ReasonButton quotationId={q.id} kind="delete" />}
          </div>
          {!anyProposal && !deleted && <p className="text-xs text-muted-foreground">A quotation can be deleted only while no proposal has been made from it.</p>}

          <div>
            <h3 className="mb-1 text-sm font-medium">Attachments</h3>
            <AttachmentsPanel ownerType="Quotation" ownerId={q.id} kinds={ATTACHMENT_KINDS.Quotation} files={files} readOnly={deleted} />
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
              <span>Customer decision</span>
              <span className="text-right text-xs text-muted-foreground">
                {q.status === "Accepted" ? <><StatusBadge tone="green">Accepted</StatusBadge><br />{q.acceptedAt && fmtDateTime(q.acceptedAt)}</>
                  : q.status === "NotAccepted" ? <StatusBadge tone="orange">Not accepted</StatusBadge> : <StatusBadge tone="slate">Waiting</StatusBadge>}
              </span>
            </li>
            {q.items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2">
                <span>Proposal · {i.insurer}</span>
                {i.proposal ? <Link href={`/proposals/${i.proposal.id}`} className="text-brand-700 hover:underline">{i.proposal.proposalNo}</Link>
                  : <StatusBadge tone={i.decision === "NotAccepted" ? "orange" : "slate"}>{i.decision === "NotAccepted" ? "Not accepted" : "Not yet"}</StatusBadge>}
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-muted-foreground">Tick the products the customer accepted, then Create proposal from selected. Lead → Quotation → Proposal → Partner / Customer → Receipt.</p>
        </aside>
      </div>
    </>
  );
}
