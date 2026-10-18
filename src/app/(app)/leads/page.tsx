import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { canActOn, userNames } from "@/lib/leads";
import { leadFilter } from "@/lib/lists";
import { seesAll } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { AddLeadDialog } from "./add-lead-dialog";
import { LeadFilters } from "./lead-filters";
import { LeadPanel } from "./lead-panel";
import { LeadsTable, type LeadRow } from "./leads-table";

type Search = { status?: string; source?: string; q?: string; id?: string };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("Lead.View");
  const sp = await searchParams;
  const { status, source, q, where } = leadFilter(user, sp);

  const [leads, users] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { calls: { where: { outcome: null }, orderBy: { dueAt: "asc" }, take: 1 } },
    }),
    userNames(user.tenantId),
  ]);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? "—";

  const rows: LeadRow[] = leads.map((l) => ({
    id: l.id,
    leadNo: l.leadNo,
    name: l.name,
    mobile: l.mobile,
    source: l.source,
    status: l.status,
    nextCallAt: l.calls[0]?.dueAt.toISOString() ?? null,
    ownerName: nameOf(l.ownerId),
  }));

  const selected = sp.id
    ? await db.lead.findFirst({
        where: { id: sp.id, tenantId: user.tenantId },
        include: { calls: { orderBy: { dueAt: "desc" } } },
      })
    : null;
  const panelLead = selected && canActOn(user, selected.ownerId) ? selected : null;

  return (
    <>
      <PageHeader title="Leads" user={user} actions={<>
        <ExportButton report="leads" user={user} params={{ status, source, q }} />
        <AddLeadDialog owners={seesAll(user.role) ? users.filter((u) => u.role === "User") : []} />
      </>} />
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 rounded-xl border bg-white p-4">
          <LeadFilters status={status} source={source} q={q} />
          <LeadsTable rows={rows} selectedId={panelLead?.id} />
        </div>
        {panelLead && (
          <LeadPanel
            key={panelLead.id + panelLead.status + (panelLead.calls[0]?.dueAt.toISOString() ?? "")}
            lead={{
              id: panelLead.id,
              leadNo: panelLead.leadNo,
              name: panelLead.name,
              mobile: panelLead.mobile,
              email: panelLead.email,
              source: panelLead.source,
              status: panelLead.status,
              interest: panelLead.interest,
              notInterestedReason: panelLead.notInterestedReason,
              ownerName: nameOf(panelLead.ownerId),
              calls: panelLead.calls.map((c) => ({
                id: c.id,
                dueAt: c.dueAt.toISOString(),
                note: c.note,
                outcome: c.outcome,
                outcomeNote: c.outcomeNote,
              })),
            }}
          />
        )}
      </div>
    </>
  );
}
