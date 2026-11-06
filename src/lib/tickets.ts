import type { TicketPriority, TicketStatus, TicketType } from "@prisma/client";
import type { Tone } from "@/components/status-badge";
import { addDays } from "@/lib/dates";
import { MENU } from "@/lib/menu";
import { hasPermission } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";

// Tickets (owner, 6 Nov 2026): staff raise problems, new feature requests and questions; Admins work on them.

export const TICKET_PRIORITY: Record<TicketPriority, [string, Tone]> = { High: ["High", "red"], Medium: ["Medium", "orange"], Low: ["Low", "slate"] };
export const TICKET_TYPE: Record<TicketType, string> = { Problem: "Problem", NewFeature: "New feature", Question: "Question" };
export const TICKET_STATUS: Record<TicketStatus, [string, Tone]> = {
  Open: ["Open", "orange"],
  InProgress: ["In progress", "purple"],
  WaitingForYou: ["Waiting for you", "red"],
  Fixed: ["Fixed – please check", "green"],
  Closed: ["Closed", "slate"],
};

/** What a ticket can be about: every menu, plus the login page and the app as a whole. */
export const TICKET_SCREENS = ["Login", ...MENU.map((m) => m.label), "Whole app"];

/** Fix target from the priority: at least 72 hours whatever the priority (owner, 6 Nov 2026) – High and Medium 3 days, Low 7 days. */
export const ticketTarget = (priority: TicketPriority, raisedOn: Date) => addDays(raisedOn, priority === "Low" ? 7 : 3);

/** Past its target while still with the developer (not while waiting for the person who raised it). */
export const isPastTarget = (t: { status: TicketStatus; targetDate: Date }, today: Date) =>
  (t.status === "Open" || t.status === "InProgress") && t.targetDate < today;

export const canManageTickets = (user: SessionUser) => hasPermission(user.role, "Ticket.Manage");

/** Admins see every ticket; others only the ones they raised. */
export const ticketScope = (user: SessionUser) => ({ tenantId: user.tenantId, ...(!canManageTickets(user) && { raisedById: user.id }) });

/** Tabs on the Tickets page; each is also a card with its count. */
export const TICKET_TABS: Record<string, { label: string; statuses: TicketStatus[] }> = {
  open: { label: "Open", statuses: ["Open", "InProgress", "WaitingForYou", "Fixed"] },
  developer: { label: "Waiting for developer", statuses: ["Open", "InProgress"] },
  you: { label: "Waiting for you", statuses: ["WaitingForYou", "Fixed"] },
  closed: { label: "Closed", statuses: ["Closed"] },
};
