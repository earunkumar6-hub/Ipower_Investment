import type { CallOutcome, Prisma } from "@prisma/client";
import { addDays, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { callInclude, callParty, ownerScope, userNames, type CallKind } from "@/lib/leads";
import type { SessionUser } from "@/lib/session";

// Follow-ups: every call about a lead, a renewal or a proposal. Shared by the screen and its export.

export const FOLLOWUP_TABS = [
  ["open", "Due now"],
  ["later", "Due later today"],
  ["upcoming", "Upcoming"],
  ["rescheduled", "Rescheduled"],
  ["closed", "Closed"],
] as const;
export type FollowUpTab = (typeof FOLLOWUP_TABS)[number][0];

const IST_OFFSET = 5.5 * 3_600_000;
/** Start of an IST day as an instant. */
const dayStart = (d: Date) => new Date(d.getTime() - IST_OFFSET);

/** Outcomes that book another call (shown under Rescheduled); the rest close the follow-up. */
const RESCHEDULED: CallOutcome[] = ["NoAnswer"];

export type FollowUpRow = {
  id: string; kind: CallKind; dueAt: Date; name: string; mobile: string; forLabel: string; href: string;
  note: string | null; ownerName: string; outcome: CallOutcome | null; outcomeNote: string | null; completedAt: Date | null; overdue: boolean;
};

export async function loadFollowUps(user: SessionUser, sp: { tab?: string }, now = new Date()) {
  const tab: FollowUpTab = FOLLOWUP_TABS.some(([k]) => k === sp.tab) ? (sp.tab as FollowUpTab) : "open";
  const today = istToday();
  const start = dayStart(today);
  const end = dayStart(addDays(today, 1));
  const base: Prisma.CallWhereInput = { tenantId: user.tenantId, ...ownerScope(user) };
  const closedToday: Prisma.CallWhereInput = { ...base, completedAt: { gte: start, lt: end } };

  const where: Record<FollowUpTab, Prisma.CallWhereInput> = {
    open: { ...base, outcome: null, dueAt: { lte: now } },
    later: { ...base, outcome: null, dueAt: { gt: now, lt: end } },
    upcoming: { ...base, outcome: null, dueAt: { gte: end } },
    rescheduled: { ...closedToday, outcome: { in: RESCHEDULED } },
    closed: { ...closedToday, outcome: { notIn: RESCHEDULED } },
  };

  const [calls, users, dueNow, allOpen, overdue, later, upcoming, rescheduled, closed] = await Promise.all([
    db.call.findMany({ where: where[tab], include: callInclude, orderBy: tab === "rescheduled" || tab === "closed" ? { completedAt: "desc" } : { dueAt: "asc" }, take: 300 }),
    userNames(user.tenantId),
    db.call.count({ where: where.open }),
    db.call.count({ where: { ...base, outcome: null } }),
    db.call.count({ where: { ...where.open, dueAt: { lt: new Date(now.getTime() - 15 * 60_000) } } }),
    db.call.count({ where: where.later }),
    db.call.count({ where: where.upcoming }),
    db.call.count({ where: where.rescheduled }),
    db.call.groupBy({ by: ["outcome"], where: where.closed, _count: true }),
  ]);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? "—";
  const closedBy = (o: CallOutcome) => closed.find((c) => c.outcome === o)?._count ?? 0;

  const rows: FollowUpRow[] = calls.map((c) => {
    const p = callParty(c);
    return {
      id: c.id, kind: p.kind, dueAt: c.dueAt, name: p.name, mobile: p.mobile, forLabel: p.forLabel, href: p.href, note: c.note,
      ownerName: nameOf(c.ownerId), outcome: c.outcome, outcomeNote: c.outcomeNote, completedAt: c.completedAt, overdue: !c.outcome && c.dueAt <= now,
    };
  });
  return {
    tab,
    rows,
    cards: {
      dueNow, open: allOpen, overdue, later, upcoming, rescheduled,
      closed: closed.reduce((t, c) => t + c._count, 0),
      interested: closedBy("Interested"), notInterested: closedBy("NotInterested"), done: closedBy("Done"),
    },
  };
}

/** Pickers for "Schedule call": open leads, active policies with an unpaid instalment, proposals not yet issued. */
export async function scheduleOptions(user: SessionUser) {
  const scope = { tenantId: user.tenantId, ...ownerScope(user) };
  const [leads, policies, proposals] = await Promise.all([
    db.lead.findMany({ where: { ...scope, status: { not: "NotInterested" }, stage: { not: "Customer" } }, select: { id: true, leadNo: true, name: true }, orderBy: { createdAt: "desc" }, take: 300 }),
    db.policy.findMany({
      where: { ...scope, status: "Active", renewals: { some: { status: { in: ["Due", "Overdue"] } } } },
      select: { id: true, policyNumber: true, partner: true, productName: true, customer: { select: { name: true } } }, orderBy: { policyNumber: "asc" }, take: 300,
    }),
    db.proposal.findMany({ where: { ...scope, status: { not: "Issued" } }, select: { id: true, proposalNo: true, customerName: true }, orderBy: { createdAt: "desc" }, take: 300 }),
  ]);
  return {
    lead: leads.map((l) => ({ id: l.id, label: `${l.leadNo} · ${l.name}` })),
    policy: policies.map((p) => ({ id: p.id, label: `${p.customer.name} · ${p.partner} ${p.productName} · ${p.policyNumber}` })),
    proposal: proposals.map((p) => ({ id: p.id, label: `${p.proposalNo} · ${p.customerName}` })),
  };
}
export type ScheduleOptions = Awaited<ReturnType<typeof scheduleOptions>>;
