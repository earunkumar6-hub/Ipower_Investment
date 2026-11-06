"use server";

import { TicketPriority, TicketStatus, TicketType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { fileProblem, storeFile } from "@/lib/attachments";
import { audit } from "@/lib/audit";
import { fmtDate, istDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { nextNumber } from "@/lib/numbering";
import { authorize } from "@/lib/session";
import { canManageTickets, TICKET_PRIORITY, TICKET_SCREENS, TICKET_STATUS, TICKET_TYPE, ticketScope, ticketTarget } from "@/lib/tickets";

const fail = (error: string, field?: string): ActionResult => ({ ok: false, error, ...(field && { fieldErrors: { [field]: error } }) });

const raiseSchema = z.object({
  title: z.string().trim().min(5, "Enter a short title (5 letters or more)").max(120, "Title is too long"),
  screen: z.string().refine((s) => TICKET_SCREENS.includes(s), "Pick the screen"),
  type: z.enum(TicketType, "Pick the type"),
  priority: z.enum(TicketPriority, "Pick the priority"),
  details: z.string().trim().min(10, "Describe what happened or what you need").max(4000, "Details are too long"),
});

/** Raise a ticket (any role with Ticket.Create): TK- number, target date from the priority, developer alert (mocked). */
export async function raiseTicket(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Ticket.Create");
  const parsed = raiseSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(issue.message, String(issue.path[0]));
  }
  const v = parsed.data;
  const file = form.get("screenshot");
  const screenshot = file instanceof File && file.size > 0 ? file : null;
  if (screenshot) {
    const problem = fileProblem(screenshot);
    if (problem) return fail(problem, "screenshot");
  }

  const today = istToday();
  const ticket = await db.$transaction(async (tx) => {
    const t = await tx.ticket.create({
      data: {
        tenantId: user.tenantId, ticketNo: await nextNumber(tx, user.tenantId, "ticket"), title: v.title, screen: v.screen, type: v.type,
        priority: v.priority, details: v.details, targetDate: ticketTarget(v.priority, today), raisedById: user.id,
      },
    });
    await audit(tx, user, { entity: "Ticket", entityId: t.id, action: "Create", summary: `${t.ticketNo} raised: ${v.title} (${TICKET_PRIORITY[v.priority][0]}, ${TICKET_TYPE[v.type]})` });
    // Developer alert, mocked into Sent messages: WhatsApp + email for High, email for Medium / Low.
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { ticketAlertMobile: true, ticketAlertEmail: true } });
    const body = `New ticket ${t.ticketNo} (${TICKET_PRIORITY[v.priority][0]}, ${TICKET_TYPE[v.type]}): ${v.title}. Screen: ${v.screen}. Raised by ${user.name}. Target ${fmtDate(t.targetDate)}.`;
    const sends = [
      v.priority === "High" && tenant.ticketAlertMobile && { channel: "WhatsApp" as const, to: tenant.ticketAlertMobile },
      tenant.ticketAlertEmail && { channel: "Email" as const, to: tenant.ticketAlertEmail },
    ].filter((s) => !!s);
    if (sends.length) {
      await tx.messageLog.createMany({
        data: sends.map((s) => ({ tenantId: user.tenantId, channel: s.channel, to: s.to, template: "ticketAlert", body, relatedType: "Ticket", relatedId: t.id, createdById: user.id })),
      });
    }
    return t;
  });
  if (screenshot) {
    const storedName = await storeFile(screenshot);
    await db.attachment.create({
      data: { tenantId: user.tenantId, ownerType: "Ticket", ownerId: ticket.id, kind: "Screenshot", fileName: screenshot.name.slice(0, 120), storedName, contentType: screenshot.type, size: screenshot.size, uploadedById: user.id },
    });
  }
  revalidatePath("/tickets");
  return { ok: true, id: ticket.id, href: `/tickets/${ticket.id}`, message: `Ticket ${ticket.ticketNo} raised` };
}

const updateSchema = z.object({
  ticketId: z.string().min(1),
  comment: z.string().trim().max(4000, "Comment is too long").default(""),
  status: z.union([z.literal(""), z.enum(TicketStatus)]).default(""),
  priority: z.union([z.literal(""), z.enum(TicketPriority)]).default(""),
});

/**
 * Comment, change status and (Admins) priority in one save. Admins may set any status; the person who raised it
 * may close it, or reopen it once it is Fixed or Closed (with a comment). A reply from the raiser while it is
 * "Waiting for you" sends it back to "In progress".
 */
export async function updateTicket(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Ticket.Create");
  const parsed = updateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;
  const manager = canManageTickets(user);

  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const t = await tx.ticket.findFirst({ where: { id: v.ticketId, ...ticketScope(user) } });
    if (!t) return fail("Ticket not found");
    const raiser = t.raisedById === user.id;
    let status = v.status && v.status !== t.status ? v.status : null;
    const priority = v.priority && v.priority !== t.priority ? v.priority : null;

    if (priority && !manager) return fail("Only an Admin can change the priority");
    if (status && !manager) {
      const reopen = status === "Open" && (t.status === "Fixed" || t.status === "Closed");
      if (status !== "Closed" && !reopen) return fail("You can close the ticket, or reopen it once it is fixed");
    }
    if (t.status === "Closed" && !status) return fail("Reopen the ticket to add to it");
    if (status === "Open" && (t.status === "Fixed" || t.status === "Closed") && !v.comment) return fail("Say what is still wrong", "comment");
    if (!status && !priority && !v.comment) return fail("Write a comment or change the status", "comment");
    if (!status && raiser && v.comment && t.status === "WaitingForYou") status = "InProgress";

    const changes = [
      status && `Status ${TICKET_STATUS[t.status][0]} → ${TICKET_STATUS[status][0]}`,
      priority && `Priority ${TICKET_PRIORITY[t.priority][0]} → ${TICKET_PRIORITY[priority][0]}`,
    ].filter(Boolean) as string[];
    await tx.ticket.update({
      where: { id: t.id },
      data: {
        ...(status && { status, ...(status === "Closed" ? { closedAt: new Date(), closedById: user.id } : { closedAt: null, closedById: null }) }),
        ...(priority && { priority, targetDate: ticketTarget(priority, istDate(t.createdAt)) }),
      },
    });
    await tx.ticketComment.create({
      data: { ticketId: t.id, authorId: user.id, body: v.comment || null, statusFrom: status ? t.status : null, statusTo: status, change: priority ? changes[changes.length - 1] : null },
    });
    await audit(tx, user, {
      entity: "Ticket", entityId: t.id, action: status === "Closed" ? "Close" : status === "Open" ? "Reopen" : "Updated",
      summary: `${t.ticketNo}: ${[...changes, v.comment && "comment added"].filter(Boolean).join(" · ")}`,
      before: { status: t.status, priority: t.priority }, after: { status: status ?? t.status, priority: priority ?? t.priority },
    });
    return { ok: true, message: changes.length ? changes.join(" · ") : "Comment added" };
  });
  if (result.ok) revalidatePath("/tickets", "layout");
  return result;
}

const alertSchema = z.object({
  mobile: z.union([z.literal(""), z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number")]),
  email: z.union([z.literal(""), z.email("Enter a valid email")]),
});

/** Where new-ticket alerts go (Settings.Edit). Blank = no alert on that channel. */
export async function saveTicketAlerts(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Settings.Edit");
  const parsed = alertSchema.safeParse({ mobile: String(form.get("mobile") ?? "").trim(), email: String(form.get("email") ?? "").trim().toLowerCase() });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(issue.message, String(issue.path[0]));
  }
  const after = { ticketAlertMobile: parsed.data.mobile || null, ticketAlertEmail: parsed.data.email || null };
  return db.$transaction(async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { id: true, ticketAlertMobile: true, ticketAlertEmail: true } });
    if (t.ticketAlertMobile === after.ticketAlertMobile && t.ticketAlertEmail === after.ticketAlertEmail) return { ok: true, message: "No change" };
    await tx.tenant.update({ where: { id: t.id }, data: after });
    await audit(tx, user, {
      entity: "Tenant", entityId: t.id, action: "Updated", summary: `Ticket alerts: WhatsApp ${after.ticketAlertMobile ?? "off"} · email ${after.ticketAlertEmail ?? "off"}`,
      before: { mobile: t.ticketAlertMobile, email: t.ticketAlertEmail }, after: { mobile: after.ticketAlertMobile, email: after.ticketAlertEmail },
    });
    revalidatePath("/tickets");
    return { ok: true, message: "Alert contacts saved" };
  });
}
