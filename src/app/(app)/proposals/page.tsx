import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/lib/db";
import { ownerScope } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { holdersLabel, proposalStatusLabel } from "./labels";
import { ListSearch } from "@/components/list-search";

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<{ q?: string; issued?: string }> }) {
  const user = await requirePermission("Proposal.View");
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  // Once the policy number is entered the proposal leaves this list and lives under Partners / Customers (#23);
  // "Show issued" brings them back for looking up.
  const showIssued = sp.issued === "1";
  const issuedCount = showIssued ? 0 : await db.proposal.count({ where: { tenantId: user.tenantId, ...ownerScope(user), status: "Issued" } });
  const proposals = await db.proposal.findMany({
    where: {
      tenantId: user.tenantId,
      ...ownerScope(user),
      ...(!showIssued && { status: { not: "Issued" as const } }),
      ...(q && {
        AND: [{
          OR: [
            { mobile: { contains: q } },
            { customerName: { contains: q, mode: "insensitive" as const } },
            { proposalNo: { contains: q, mode: "insensitive" as const } },
          ],
        }],
      }),
    },
    include: { secondHolder: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <>
      <PageHeader title="Proposals" user={user} actions={<ExportButton report="proposals" user={user} params={showIssued ? { issued: "1" } : {}} />} />
      <div className="rounded-xl border bg-white p-4">
        <div className="flex items-start justify-between gap-2">
          <ListSearch q={q} />
          <Link href={showIssued ? `/proposals${q ? `?q=${encodeURIComponent(q)}` : ""}` : `/proposals?${new URLSearchParams({ issued: "1", ...(q && { q }) })}`}
            className="shrink-0 pt-2 text-xs text-brand-700 hover:underline">
            {showIssued ? "Hide issued proposals" : `Show issued proposals (${issuedCount})`}
          </Link>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No.</TableHead><TableHead>Customer</TableHead><TableHead>Partner</TableHead>
              <TableHead className="text-right">Premium</TableHead><TableHead>Consent</TableHead><TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proposals.map((p) => {
              const [label, tone] = proposalStatusLabel(p);
              return (
                <TableRow key={p.id}>
                  <TableCell><Link href={`/proposals/${p.id}`} className="text-brand-700 hover:underline">{p.proposalNo}</Link></TableCell>
                  <TableCell>{holdersLabel(p)}</TableCell>
                  <TableCell>{p.insurer} – {p.productName}</TableCell>
                  <TableCell className="text-right">{p.premium.gt(0) ? fmtINR(p.premium) : "—"}</TableCell>
                  <TableCell>{p.consentAt ? <StatusBadge tone="green">Taken</StatusBadge> : <StatusBadge tone="slate">Not ticked</StatusBadge>}</TableCell>
                  <TableCell><StatusBadge tone={tone}>{label}</StatusBadge></TableCell>
                </TableRow>
              );
            })}
            {proposals.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{q ? `No proposals match "${q}".` : showIssued ? "No proposals yet." : "No proposals waiting for a policy number. Issued ones are under Partners / Customers."}</TableCell></TableRow>
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
