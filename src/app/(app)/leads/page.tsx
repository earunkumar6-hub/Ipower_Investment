import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { fmtDmy, isoDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn, interestOptions, userNames } from "@/lib/leads";
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

  const [leads, users, products] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { calls: { where: { outcome: null }, orderBy: { dueAt: "asc" }, take: 1 } },
    }),
    userNames(user.tenantId),
    interestOptions(user.tenantId),
  ]);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? "—";

  const rows: LeadRow[] = leads.map((l) => ({
    id: l.id,
    leadNo: l.leadNo,
    name: l.name,
    mobile: l.mobile,
    source: l.source,
    referrerName: l.referrerName,
    interest: l.interest,
    status: l.status,
    stage: l.stage,
    nextCallAt: l.calls[0]?.dueAt.toISOString() ?? null,
    ownerName: nameOf(l.ownerId),
  }));

  const selected = sp.id
    ? await db.lead.findFirst({
        where: { id: sp.id, tenantId: user.tenantId },
        include: { calls: { orderBy: { dueAt: "desc" } }, mobiles: { orderBy: { sort: "asc" } } },
      })
    : null;
  const panelLead = selected && canActOn(user, selected.ownerId) ? selected : null;

  return (
    <>
      <PageHeader title="Leads" user={user} actions={<>
        <ExportButton report="leads" user={user} params={{ status, source, q }} />
        <AddLeadDialog owners={seesAll(user.role) ? users.filter((u) => u.role === "User") : []} products={products} />
      </>} />
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 rounded-xl border bg-white p-4">
          <LeadFilters status={status} source={source} q={q} />
          <LeadsTable rows={rows} selectedId={panelLead?.id} />
        </div>
        {panelLead && (
          <LeadPanel
            key={panelLead.id + panelLead.status + panelLead.updatedAt.toISOString() + (panelLead.calls[0]?.dueAt.toISOString() ?? "")}
            products={products}
            lead={{
              id: panelLead.id,
              leadNo: panelLead.leadNo,
              name: panelLead.name,
              details: {
                firstName: panelLead.firstName, lastName: panelLead.lastName ?? "", dob: panelLead.dob ? isoDate(panelLead.dob) : "", gender: panelLead.gender ?? "",
                mobiles: panelLead.mobiles.length ? panelLead.mobiles.map((m) => ({ number: m.number, isWhatsApp: m.isWhatsApp })) : [{ number: panelLead.mobile, isWhatsApp: panelLead.onWhatsApp }],
                email: panelLead.email ?? "", address: panelLead.address ?? "", source: panelLead.source, referrerName: panelLead.referrerName ?? "",
                interest: panelLead.interest ?? "", notes: panelLead.notes ?? "",
              },
              dobLabel: panelLead.dob ? fmtDmy(panelLead.dob) : null,
              status: panelLead.status,
              stage: panelLead.stage,
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
