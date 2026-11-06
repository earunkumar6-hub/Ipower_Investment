// Tickets (6 Nov 2026): raise with TK- number, target from priority, developer alert (mocked); who sees and changes what.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isoDate, istToday } from "@/lib/dates";
import { prisma } from "@/lib/db";

type U = { id: string; name: string; username: string; role: "Admin" | "User" | "SuperAdmin"; tenantId: string };
const session = vi.hoisted(() => ({ user: null as null | U }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", async () => {
  const { hasPermission } = await import("@/lib/permissions");
  return {
    authorize: async (permission: Parameters<typeof hasPermission>[1]) => {
      if (!session.user) throw new Error("Not signed in");
      if (!hasPermission(session.user.role, permission)) throw new Error(`Not allowed: ${permission}`);
      return session.user;
    },
  };
});

const { raiseTicket, updateTicket, saveTicketAlerts } = await import("@/app/(app)/tickets/actions");
const { ticketTarget } = await import("@/lib/tickets");
const { attachmentOwner } = await import("@/lib/attachments");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};
const started = new Date();
const users = {} as Record<"arun" | "divya" | "admin" | "superadmin", U>;
let alertsBefore: { ticketAlertMobile: string | null; ticketAlertEmail: string | null };
const as = (u: U) => { session.user = u; };
const raise = (o: Record<string, string> = {}) =>
  raiseTicket({ ok: false }, form({ title: "Receipt PDF not opening", screen: "Receipts", type: "Problem", priority: "Medium", details: "Clicked print on RCPT-0001, nothing opens.", ...o }));
const update = (ticketId: string, o: Record<string, string>) => updateTicket({ ok: false }, form({ ticketId, comment: "", status: "", priority: "", ...o }));
const ticket = (id: string) => prisma.ticket.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  for (const k of ["arun", "divya", "admin", "superadmin"] as const) {
    const u = await prisma.user.findFirstOrThrow({ where: { username: k } });
    users[k] = { id: u.id, name: u.name, username: k, role: u.role, tenantId: u.tenantId };
  }
  alertsBefore = await prisma.tenant.findUniqueOrThrow({ where: { id: users.arun.tenantId }, select: { ticketAlertMobile: true, ticketAlertEmail: true } });
});

afterAll(async () => {
  const ids = (await prisma.ticket.findMany({ where: { createdAt: { gte: started } }, select: { id: true } })).map((t) => t.id);
  await prisma.messageLog.deleteMany({ where: { relatedType: "Ticket", relatedId: { in: ids } } });
  await prisma.ticket.deleteMany({ where: { id: { in: ids } } });
  await prisma.tenant.update({ where: { id: users.arun.tenantId }, data: alertsBefore });
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.$disconnect();
});

describe("Ticket target dates", () => {
  it("at least 72 hours whatever the priority: High and Medium 3 days, Low 7 days", () => {
    const friday = new Date("2026-11-06T00:00:00Z");
    expect(isoDate(ticketTarget("High", friday))).toBe("2026-11-09");
    expect(isoDate(ticketTarget("Medium", friday))).toBe("2026-11-09");
    expect(isoDate(ticketTarget("Low", friday))).toBe("2026-11-13");
  });
});

describe("Raise ticket", () => {
  it("checks the fields and numbers tickets TK-", async () => {
    as(users.arun);
    expect(await raise({ screen: "" })).toMatchObject({ ok: false, fieldErrors: { screen: "Pick the screen" } });
    expect((await raise({ details: "short" })).fieldErrors?.details).toBeDefined();
    const r = await raise();
    expect(r.ok).toBe(true);
    const t = await ticket(r.id!);
    expect(t).toMatchObject({ status: "Open", priority: "Medium", raisedById: users.arun.id });
    expect(t.ticketNo).toMatch(/^TK-\d{4}$/);
    expect(isoDate(t.targetDate)).toBe(isoDate(ticketTarget("Medium", istToday())));
  });

  it("alerts the developer: WhatsApp + email for High, email only for Medium / Low", async () => {
    as(users.arun);
    await expect(saveTicketAlerts({ ok: false }, form({ mobile: "9876500000", email: "dev@example.com" }))).rejects.toThrow("Not allowed: Settings.Edit");
    as(users.superadmin);
    expect((await saveTicketAlerts({ ok: false }, form({ mobile: "12345", email: "" }))).fieldErrors?.mobile).toBeDefined();
    expect((await saveTicketAlerts({ ok: false }, form({ mobile: "9876500000", email: "Dev@Example.com" }))).ok).toBe(true);
    as(users.arun);
    const high = await raise({ priority: "High", title: "Day Book total wrong" });
    const low = await raise({ priority: "Low", type: "NewFeature", title: "Add a dark theme" });
    const sent = (id: string) => prisma.messageLog.findMany({ where: { relatedType: "Ticket", relatedId: id }, orderBy: { channel: "asc" } });
    expect((await sent(high.id!)).map((m) => [m.channel, m.to])).toEqual([["WhatsApp", "9876500000"], ["Email", "dev@example.com"]]);
    expect((await sent(low.id!)).map((m) => [m.channel, m.to])).toEqual([["Email", "dev@example.com"]]);
  });

  it("keeps the screenshot as a ticket file", async () => {
    as(users.arun);
    const f = form({ title: "Blank Day Book page", screen: "Day Book", type: "Problem", priority: "Low", details: "The Day Book page shows nothing today." });
    f.append("screenshot", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "screen.png", { type: "image/png" }));
    const r = await raiseTicket({ ok: false }, f);
    expect(r.ok).toBe(true);
    const files = await prisma.attachment.findMany({ where: { ownerType: "Ticket", ownerId: r.id! } });
    expect(files.map((a) => [a.kind, a.fileName, a.uploadedById])).toEqual([["Screenshot", "screen.png", users.arun.id]]);
    const { deleteStoredFile } = await import("@/lib/attachments");
    await deleteStoredFile(files[0].storedName);
    await prisma.attachment.delete({ where: { id: files[0].id } });
  });
});

describe("Working on a ticket", () => {
  it("only the raiser and Admins see it; files follow the same rule", async () => {
    as(users.arun);
    const { id } = await raise();
    as(users.divya);
    expect(await update(id!, { comment: "Me too" })).toMatchObject({ ok: false, error: "Ticket not found" });
    expect(await attachmentOwner(users.divya, "Ticket", id!)).toBeNull();
    expect(await attachmentOwner(users.arun, "Ticket", id!)).not.toBeNull();
    expect(await attachmentOwner(users.admin, "Ticket", id!)).not.toBeNull();
  });

  it("raiser: no priority or developer statuses; reply to Waiting for you goes back In progress; reopen needs a comment; close", async () => {
    as(users.arun);
    const { id } = await raise();
    expect((await update(id!, { priority: "High" })).error).toBe("Only an Admin can change the priority");
    expect((await update(id!, { status: "InProgress" })).error).toBe("You can close the ticket, or reopen it once it is fixed");
    expect((await update(id!, {})).error).toBe("Write a comment or change the status");

    as(users.admin);
    expect(await update(id!, { status: "WaitingForYou", comment: "Which receipt?" })).toMatchObject({ ok: true });
    as(users.arun);
    expect((await update(id!, { comment: "RCPT-0001" })).ok).toBe(true);
    expect((await ticket(id!)).status).toBe("InProgress");

    as(users.admin);
    expect((await update(id!, { status: "Fixed" })).ok).toBe(true);
    as(users.arun);
    expect((await update(id!, { status: "Open" })).error).toBe("Say what is still wrong");
    expect((await update(id!, { status: "Open", comment: "Still blank" })).ok).toBe(true);
    expect((await update(id!, { status: "Closed" })).ok).toBe(true);
    const closed = await ticket(id!);
    expect([closed.status, closed.closedById, !!closed.closedAt]).toEqual(["Closed", users.arun.id, true]);
    expect((await update(id!, { comment: "One more thing" })).error).toBe("Reopen the ticket to add to it");

    const thread = await prisma.ticketComment.findMany({ where: { ticketId: id! }, orderBy: { createdAt: "asc" } });
    expect(thread.map((c) => c.statusTo)).toEqual(["WaitingForYou", "InProgress", "Fixed", "Open", "Closed"]);
    expect(await prisma.auditLog.count({ where: { entity: "Ticket", entityId: id! } })).toBe(6); // raised + 5 changes
  });

  it("Admin: a new priority resets the target from the day it was raised", async () => {
    as(users.arun);
    const { id } = await raise({ priority: "Low" });
    as(users.admin);
    expect(await update(id!, { priority: "High" })).toMatchObject({ ok: true, message: "Priority Low → High" });
    const t = await ticket(id!);
    expect([t.priority, isoDate(t.targetDate)]).toEqual(["High", isoDate(ticketTarget("High", istToday()))]);
  });
});
