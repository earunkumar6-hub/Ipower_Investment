import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtTime, isoDate, istDate, istToday } from "@/lib/dates";
import { FOLLOWUP_TABS, loadFollowUps, scheduleOptions } from "@/lib/followups";
import { maskMobile, OUTCOME_LABEL } from "@/lib/lead-labels";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { OpenCallButton, ScheduleCallButton } from "./followup-actions";

/** Follow-ups: call reminders for leads, renewals and proposals. */
export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePermission("Lead.View");
  const now = new Date();
  const [f, options] = await Promise.all([loadFollowUps(user, await searchParams, now), scheduleOptions(user)]);
  const { cards, tab } = f;
  const today = istToday();
  const when = (d: Date) => (isoDate(istDate(d)) === isoDate(today) ? fmtTime(d) : `${fmtDate(istDate(d))} ${fmtTime(d)}`);
  const counts: Record<string, number> = { open: cards.dueNow, later: cards.later, upcoming: cards.upcoming, rescheduled: cards.rescheduled, closed: cards.closed };

  return (
    <>
      <PageHeader title="Follow-ups" user={user} actions={<>
        <ExportButton report="followups" user={user} params={{ tab }} />
        <ScheduleCallButton options={options} />
      </>} />
      <div className="mb-4 grid grid-cols-4 gap-3">
        <StatCard title="Calls open" value={String(cards.open)} sub={`${cards.dueNow} due now · ${cards.overdue} overdue`} alert={cards.overdue > 0} href="/followups?tab=open" />
        <StatCard title="Due later today" value={String(cards.later)} href="/followups?tab=later" />
        <StatCard title="Rescheduled today" value={String(cards.rescheduled)} href="/followups?tab=rescheduled" />
        <StatCard title="Closed today" value={String(cards.closed)} sub={`Interested ${cards.interested} · Not interested ${cards.notInterested}${cards.done ? ` · Done ${cards.done}` : ""}`} href="/followups?tab=closed" />
      </div>
      <div className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 font-semibold">Call reminders</h2>
        <div className="mb-3 flex gap-1 border-b">
          {FOLLOWUP_TABS.map(([key, label]) => (
            <Link key={key} href={`/followups?tab=${key}`}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === key ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {label} ({counts[key]})
            </Link>
          ))}
        </div>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Due</TableHead><TableHead>Name</TableHead><TableHead>Mobile</TableHead><TableHead>For</TableHead><TableHead>Last note</TableHead><TableHead>Owner</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {f.rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className={cn("whitespace-nowrap", r.overdue && "font-medium text-orange-700")}>{r.overdue && r.dueAt.getTime() < now.getTime() - 15 * 60_000 ? "Overdue · " : r.overdue ? "Now · " : ""}{when(r.dueAt)}</TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell>{maskMobile(r.mobile)}</TableCell>
                <TableCell><Link href={r.href} className="text-brand-700 hover:underline">{r.forLabel}</Link></TableCell>
                <TableCell className="max-w-64 truncate" title={r.outcomeNote ?? r.note ?? undefined}>{r.outcomeNote ?? r.note ?? "—"}</TableCell>
                <TableCell>{r.ownerName}</TableCell>
                <TableCell>
                  {r.outcome ? <StatusBadge tone={r.outcome === "NotInterested" ? "orange" : r.outcome === "NoAnswer" ? "slate" : "green"}>{OUTCOME_LABEL[r.outcome]}</StatusBadge>
                    : r.overdue ? <StatusBadge tone="red">Open</StatusBadge> : <StatusBadge tone="blue">Scheduled</StatusBadge>}
                </TableCell>
                <TableCell className="text-right">{!r.outcome && <OpenCallButton callId={r.id} />}</TableCell>
              </TableRow>
            ))}
            {f.rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">Nothing here.</TableCell></TableRow>}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          An open call shows on every screen (orange button at the top) and its reminder stays open until the caller saves an outcome or a new call time.
        </p>
      </div>
    </>
  );
}
