import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { CONSENT_TONE, PROPOSAL_STATUS } from "../labels";
import { IssuePolicyForm, KycForm, SimulateOtpButton } from "./proposal-forms";

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("Proposal.View");
  const { id } = await params;
  const p = await db.proposal.findFirst({
    where: { id, tenantId: user.tenantId },
    include: { quotation: true, consents: { orderBy: { createdAt: "desc" }, take: 1 }, policy: { include: { renewals: { orderBy: { dueDate: "asc" } } } } },
  });
  if (!p || !canActOn(user, p.ownerId)) notFound();
  const consent = p.consents[0] ?? null;
  const consentGiven = consent?.status === "Given";
  const issued = p.status === "Issued";
  const [statusLabel, statusTone] = PROPOSAL_STATUS[p.status];

  return (
    <>
      <PageHeader title="Proposals" user={user} />
      {issued && p.policy && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          Policy <b>{p.policy.policyNumber}</b> issued and moved to Partners / Customers under {p.customerName}.
          {p.policy.renewals[0] && <> Next renewal due {fmtDate(p.policy.renewals[0].dueDate)} ({fmtINR(p.policy.renewals[0].premiumAmount)}).</>}
        </div>
      )}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-4 rounded-xl border bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">
              Proposal {p.proposalNo} · {p.customerName} · from{" "}
              <Link href={`/quotations/${p.quotationId}`} className="text-brand-700 hover:underline">{p.quotation.quoteNo}</Link>
            </h2>
            <StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Partner</dt><dd>{p.insurer}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Plan</dt><dd>{p.productName}{p.sumInsured && ` · ${fmtINR(p.sumInsured)}`}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Premium (incl. GST)</dt><dd>{fmtINR(p.premium)}</dd></div>
          </dl>
          <Table>
            <TableHeader><TableRow><TableHead>Step</TableHead><TableHead>Status</TableHead><TableHead>When / detail</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Consent link sent (SMS + WhatsApp)</TableCell>
                <TableCell>{consent ? <StatusBadge tone="green">Sent</StatusBadge> : "—"}</TableCell>
                <TableCell>{consent && fmtDateTime(consent.createdAt)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Customer OTP approval</TableCell>
                <TableCell>{consent && <StatusBadge tone={consentGiven ? "green" : CONSENT_TONE[consent.status]}>{consentGiven ? "Given" : consent.status === "Sent" ? "Waiting" : consent.status}</StatusBadge>}</TableCell>
                <TableCell>{consent?.otpVerifiedOn ? fmtDateTime(consent.otpVerifiedOn) : !issued && consent?.status === "Sent" && <SimulateOtpButton proposalId={p.id} />}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Aadhaar and PAN</TableCell>
                <TableCell>{p.panMasked ? <StatusBadge tone="green">Entered – masked</StatusBadge> : consentGiven ? <StatusBadge tone="orange">Not yet</StatusBadge> : <StatusBadge tone="slate">Locked</StatusBadge>}</TableCell>
                <TableCell>{[p.aadhaarLast4 && `XXXX-XXXX-${p.aadhaarLast4}`, p.panMasked].filter(Boolean).join(" · ")}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Policy issued by partner</TableCell>
                <TableCell>{issued ? <StatusBadge tone="green">Issued</StatusBadge> : <StatusBadge tone="slate">Not yet</StatusBadge>}</TableCell>
                <TableCell>{p.policyNumber ?? "—"}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {!issued && <IssuePolicyForm proposalId={p.id} ready={consentGiven && !!p.panMasked} />}
          {issued && p.policy && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Renewal schedule</h3>
              <ul className="text-sm">
                {p.policy.renewals.map((r) => <li key={r.id}>{fmtDate(r.dueDate)} · {fmtINR(r.premiumAmount)} · {r.status}</li>)}
              </ul>
            </div>
          )}
        </div>
        <aside className="w-80 shrink-0 rounded-xl border bg-white p-4">
          <h2 className="mb-3 font-semibold">Aadhaar and PAN</h2>
          <KycForm key={`${consentGiven}-${issued}-${p.panMasked}-${p.aadhaarLast4}`} proposalId={p.id} unlocked={consentGiven && !issued} panMasked={p.panMasked} aadhaarLast4={p.aadhaarLast4} />
        </aside>
      </div>
    </>
  );
}
