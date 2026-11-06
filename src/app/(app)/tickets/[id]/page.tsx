import Link from "next/link";
import { notFound } from "next/navigation";
import { AttachmentsPanel } from "@/components/attachments-panel";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { attachmentRows } from "@/lib/attachments";
import { fmtDate, fmtDateTime, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { ATTACHMENT_LIST, dropdownValues } from "@/lib/dropdowns";
import { userNames } from "@/lib/leads";
import { requirePermission } from "@/lib/session";
import { canManageTickets, isPastTarget, TICKET_PRIORITY, TICKET_STATUS, TICKET_TYPE, ticketScope } from "@/lib/tickets";
import { cn } from "@/lib/utils";
import { TicketUpdateForm } from "./update-form";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("Ticket.Create");
  const { id } = await params;
  const t = await db.ticket.findFirst({ where: { id, ...ticketScope(user) }, include: { comments: { orderBy: { createdAt: "asc" } } } });
  if (!t) notFound();
  const [users, files, kinds] = await Promise.all([
    userNames(user.tenantId), attachmentRows(user, "Ticket", t.id), dropdownValues(db, user.tenantId, ATTACHMENT_LIST.Ticket),
  ]);
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? "—";
  const manager = canManageTickets(user);
  const raiser = t.raisedById === user.id;
  const closed = t.status === "Closed";
  const late = isPastTarget(t, istToday());
  const [pLabel, pTone] = TICKET_PRIORITY[t.priority];
  const [sLabel, sTone] = TICKET_STATUS[t.status];

  // What this person may change (the server checks the same rules).
  const statuses = manager
    ? (Object.keys(TICKET_STATUS) as (keyof typeof TICKET_STATUS)[]).filter((s) => s !== t.status).map((s) => ({ value: s, label: s === "Open" && closed ? "Reopen" : TICKET_STATUS[s][0] }))
    : [
      ...(t.status === "Fixed" || closed ? [{ value: "Open", label: "Reopen – still not right" }] : []),
      ...(!closed ? [{ value: "Closed", label: "Close – no longer needed / fixed" }] : []),
    ];
  const priorities = manager && !closed ? (Object.keys(TICKET_PRIORITY) as (keyof typeof TICKET_PRIORITY)[]).filter((p) => p !== t.priority).map((p) => ({ value: p, label: TICKET_PRIORITY[p][0] })) : [];
  const hint = closed
    ? "Closed. Reopen it to add more."
    : manager
      ? "Waiting for you = waiting for the person who raised it. Fixed – please check lets them confirm or reopen. A new priority resets the target date."
      : t.status === "WaitingForYou"
        ? "The developer is waiting for your reply; your comment sends it back to them."
        : t.status === "Fixed"
          ? "Please check the fix: close the ticket if it works, or reopen it and say what is still wrong."
          : "Add details or close the ticket if it is no longer needed.";

  return (
    <>
      <PageHeader title="Tickets" user={user} actions={<Link href="/tickets" className="text-sm text-brand-700 hover:underline">All tickets</Link>} />
      <div className="max-w-4xl space-y-4 rounded-xl border bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-semibold">{t.ticketNo} · {t.title}</h2>
          <div className="flex shrink-0 gap-1"><StatusBadge tone={pTone}>{pLabel}</StatusBadge><StatusBadge tone={sTone}>{sLabel}</StatusBadge></div>
        </div>
        <dl className="grid grid-cols-4 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Type</dt><dd>{TICKET_TYPE[t.type]}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Screen</dt><dd>{t.screen}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Raised by</dt><dd>{nameOf(t.raisedById)} · {fmtDateTime(t.createdAt)}</dd></div>
          <div>
            <dt className="text-xs text-muted-foreground">{closed ? "Closed" : "Target"}</dt>
            <dd className={cn(late && "font-medium text-destructive")}>
              {closed ? `${t.closedAt ? fmtDateTime(t.closedAt) : ""} by ${nameOf(t.closedById)}` : <>{fmtDate(t.targetDate)}{late && " · missed"}</>}
            </dd>
          </div>
        </dl>
        <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{t.details}</p>

        <div>
          <h3 className="mb-1 text-sm font-medium">Files</h3>
          <AttachmentsPanel ownerType="Ticket" ownerId={t.id} kinds={kinds} files={files} readOnly={closed} />
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium">History</h3>
          <ol className="space-y-2 text-sm">
            {t.comments.map((c) => (
              <li key={c.id} className="rounded-lg border p-2">
                <div className="text-xs text-muted-foreground">
                  {nameOf(c.authorId)} · {fmtDateTime(c.createdAt)}
                  {c.statusTo && <> · {c.statusFrom && `${TICKET_STATUS[c.statusFrom][0]} → `}<b>{TICKET_STATUS[c.statusTo][0]}</b></>}
                  {c.change && ` · ${c.change}`}
                </div>
                {c.body && <p className="mt-1 whitespace-pre-wrap">{c.body}</p>}
              </li>
            ))}
            {t.comments.length === 0 && <li className="text-muted-foreground">No replies yet.</li>}
          </ol>
        </div>

        {(manager || raiser) && <TicketUpdateForm ticketId={t.id} statuses={statuses} priorities={priorities} hint={hint} />}
      </div>
    </>
  );
}
