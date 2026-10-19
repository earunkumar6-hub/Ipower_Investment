import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { ownerScope } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { CONSENT_TONE, PROPOSAL_NEXT, PROPOSAL_STATUS } from "./labels";

export default async function ProposalsPage() {
  const user = await requirePermission("Proposal.View");
  const proposals = await db.proposal.findMany({
    where: { tenantId: user.tenantId, ...ownerScope(user) },
    include: { consents: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <>
      <PageHeader title="Proposals" user={user} actions={<ExportButton report="proposals" user={user} />} />
      <div className="rounded-xl border bg-white p-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No.</TableHead><TableHead>Customer</TableHead><TableHead>Partner</TableHead>
              <TableHead className="text-right">Premium</TableHead><TableHead>Consent</TableHead><TableHead>Status</TableHead><TableHead>Next</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proposals.map((p) => {
              const consent = p.consents[0]?.status;
              const [label, tone] = PROPOSAL_STATUS[p.status];
              return (
                <TableRow key={p.id}>
                  <TableCell><Link href={`/proposals/${p.id}`} className="text-brand-700 hover:underline">{p.proposalNo}</Link></TableCell>
                  <TableCell>{p.customerName}</TableCell>
                  <TableCell>{p.insurer} – {p.productName}</TableCell>
                  <TableCell className="text-right">{fmtINR(p.premium)}</TableCell>
                  <TableCell>{consent ? <StatusBadge tone={CONSENT_TONE[consent]}>{consent}</StatusBadge> : "—"}</TableCell>
                  <TableCell><StatusBadge tone={tone}>{label}</StatusBadge></TableCell>
                  <TableCell className="text-muted-foreground">{p.status === "ConsentGiven" && !p.panMasked ? "Enter PAN" : PROPOSAL_NEXT[p.status]}</TableCell>
                </TableRow>
              );
            })}
            {proposals.length === 0 && (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No proposals yet. Create one from an accepted quotation.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <p className="mt-4 rounded-lg bg-slate-100 p-3 text-xs text-muted-foreground">
        When the partner issues the policy, entering the policy number moves the proposal to Partners / Customers and creates its renewal schedule.
      </p>
    </>
  );
}
