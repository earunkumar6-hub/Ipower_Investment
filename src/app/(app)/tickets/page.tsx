import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, istDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { userNames } from "@/lib/leads";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { canManageTickets, isPastTarget, TICKET_PRIORITY, TICKET_STATUS, TICKET_TABS, TICKET_TYPE, ticketScope } from "@/lib/tickets";
import { cn } from "@/lib/utils";
import { AlertContactsForm } from "./alert-contacts-form";

/** Tickets: problems, new feature requests and questions. Admins see all; others their own. */
export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePermission("Ticket.Create");
  const sp = await searchParams;
  const tab = sp.tab && TICKET_TABS[sp.tab] ? sp.tab : "open";
  const scope = ticketScope(user);
  const today = istToday();
  // Start of this month (IST) as an instant, for "Closed this month".
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1) - 330 * 60_000);
  const count = (key: string) => db.ticket.count({ where: { ...scope, status: { in: TICKET_TABS[key].statuses } } });
  const [tickets, users, open, openHigh, developer, you, closedThisMonth, tenant] = await Promise.all([
    db.ticket.findMany({
      where: { ...scope, status: { in: TICKET_TABS[tab].statuses } },
      orderBy: tab === "closed" ? [{ closedAt: "desc" }] : [{ priority: "asc" }, { createdAt: "asc" }],
      take: 200,
    }),
    userNames(user.tenantId),
    count("open"),
    db.ticket.count({ where: { ...scope, priority: "High", status: { in: TICKET_TABS.open.statuses } } }),
    count("developer"),
    count("you"),
    db.ticket.count({ where: { ...scope, status: "Closed", closedAt: { gte: monthStart } } }),
    db.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { ticketAlertMobile: true, ticketAlertEmail: true } }),
  ]);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? "—";
  const counts: Record<string, number> = { open, developer, you, closed: closedThisMonth };

  return (
    <>
      <PageHeader title="Tickets" user={user} actions={
        <Link href="/tickets/new" className={cn(buttonVariants(), "bg-brand-600 hover:bg-brand-700")}>Raise ticket</Link>
      } />
      <div className="mb-4 grid grid-cols-4 gap-3">
        <StatCard title="Open" value={String(open)} sub={`${openHigh} high priority`} alert={openHigh > 0} href="/tickets?tab=open" highlight={tab === "open"} />
        <StatCard title="Waiting for developer" value={String(developer)} sub="Open or in progress" href="/tickets?tab=developer" highlight={tab === "developer"} />
        <StatCard title="Waiting for you" value={String(you)} sub="Reply, or check the fix" alert={you > 0} href="/tickets?tab=you" highlight={tab === "you"} />
        <StatCard title="Closed this month" value={String(closedThisMonth)} href="/tickets?tab=closed" highlight={tab === "closed"} />
      </div>
      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex gap-1 border-b">
          <h2 className="mr-4 pb-2 font-semibold">{canManageTickets(user) ? "All tickets" : "My tickets"}</h2>
          {Object.entries(TICKET_TABS).map(([key, t]) => (
            <Link key={key} href={`/tickets?tab=${key}`}
              className={cn("-mb-px border-b-2 px-3 pb-2 text-sm", tab === key ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t.label}{key !== "closed" && ` (${counts[key]})`}
            </Link>
          ))}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No.</TableHead><TableHead>Title</TableHead><TableHead>Screen</TableHead><TableHead>Priority</TableHead>
              <TableHead>Raised by</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Age</TableHead><TableHead>Target</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tickets.map((t) => {
              const [pLabel, pTone] = TICKET_PRIORITY[t.priority];
              const [sLabel, sTone] = TICKET_STATUS[t.status];
              const age = Math.round((today.getTime() - istDate(t.createdAt).getTime()) / 86_400_000);
              const late = isPastTarget(t, today);
              return (
                <TableRow key={t.id}>
                  <TableCell><Link href={`/tickets/${t.id}`} className="text-brand-700 hover:underline">{t.ticketNo}</Link></TableCell>
                  <TableCell className="max-w-80 whitespace-normal">
                    <Link href={`/tickets/${t.id}`} className="hover:underline">{t.title}</Link>
                    <span className="block text-xs text-muted-foreground">{TICKET_TYPE[t.type]}</span>
                  </TableCell>
                  <TableCell>{t.screen}</TableCell>
                  <TableCell><StatusBadge tone={pTone}>{pLabel}</StatusBadge></TableCell>
                  <TableCell>{nameOf(t.raisedById)}</TableCell>
                  <TableCell><StatusBadge tone={sTone}>{sLabel}</StatusBadge></TableCell>
                  <TableCell className="text-right">{age === 0 ? "Today" : `${age} d`}</TableCell>
                  <TableCell className={cn(late && "font-medium text-destructive")}>
                    {t.status === "Closed" ? `Closed ${t.closedAt ? fmtDate(istDate(t.closedAt)) : ""}` : <>{fmtDate(t.targetDate)}{late && " · missed"}</>}
                  </TableCell>
                </TableRow>
              );
            })}
            {tickets.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">No tickets here.</TableCell></TableRow>}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          Fix targets: High the same day, Medium 2 working days, Low 7 days. Sorted by priority, oldest first.
        </p>
      </div>
      {hasPermission(user.role, "Settings.Edit") && (
        <div className="mt-4 max-w-2xl rounded-xl border bg-white p-4">
          <h2 className="mb-1 font-semibold">Developer alerts</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Each new ticket is sent here: WhatsApp and email for High, email for Medium and Low. Messages are not really sent yet – they appear in Sent messages.
          </p>
          <AlertContactsForm mobile={tenant.ticketAlertMobile ?? ""} email={tenant.ticketAlertEmail ?? ""} />
        </div>
      )}
    </>
  );
}
