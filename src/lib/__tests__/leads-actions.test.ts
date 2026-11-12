// Leads and follow-ups (Oct 2026 round 2): lead form rules, several mobiles, edit, statuses, calls about leads,
// renewals and proposals, and the Follow-ups tabs. Every row the tests create is removed afterwards.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, isoDate, istToday } from "@/lib/dates";
import { db, prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/session";

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

const { createLead, editLead, updateLead, saveCallOutcome, scheduleCall } = await import("@/app/(app)/leads/actions");
const { loadFollowUps } = await import("@/lib/followups");
const { advanceStage } = await import("@/lib/leads");

const started = new Date();
const users = {} as Record<"arun" | "divya" | "admin", U>;
const created: string[] = [];
const as = (u: U) => { session.user = u; };
const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
// Numbers no seeded lead uses.
const stamp = String(Date.now()).slice(-8);
const num = (n: number) => `9${n}${stamp}`.slice(0, 10);
const tomorrow = isoDate(addDays(istToday(), 1));
const base = {
  firstName: "Test", lastName: "Lead", dob: "1990-05-12", gender: "Female", mobile: [num(1)], whatsApp: ["0"], email: "", address: "",
  source: "WalkIn", referrerName: "", interest: "Post Office RD", notes: "", status: "Interested", reason: "", ownerId: "", callDate: "", callTime: "",
};
const add = async (o: Partial<Record<keyof typeof base, string | string[]>> = {}) => {
  const r = await createLead({ ok: false }, form({ ...base, ...o }));
  if (r.ok) created.push(r.id!);
  return r;
};

beforeAll(async () => {
  for (const k of ["arun", "divya", "admin"] as const) {
    const u = await prisma.user.findFirstOrThrow({ where: { username: k } });
    users[k] = { id: u.id, name: u.name, username: k, role: u.role, tenantId: u.tenantId };
  }
});

afterAll(async () => {
  await prisma.call.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.lead.deleteMany({ where: { id: { in: created } } });
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.$disconnect();
});

describe("Lead form", () => {
  it("first name, date of birth, gender, mobile, status and business type are required", async () => {
    as(users.arun);
    const r = await add({ firstName: "", dob: "", gender: "", source: "" });
    expect(Object.keys(r.fieldErrors ?? {})).toEqual(expect.arrayContaining(["firstName", "dob", "gender", "source"]));
    expect((await add({ mobile: [""] })).fieldErrors).toHaveProperty("mobile");
    expect((await add({ mobile: ["12345"] })).error).toMatch(/not a 10-digit/);
    expect((await add({ status: "" })).fieldErrors).toHaveProperty("status");
    expect((await add({ dob: isoDate(istToday()) })).fieldErrors).toHaveProperty("dob");
  });

  it("Referral needs the referrer's name; Call back needs a call time; Not interested needs a reason", async () => {
    as(users.arun);
    expect((await add({ source: "Referral" })).fieldErrors).toHaveProperty("referrerName");
    expect((await add({ status: "CallBack" })).fieldErrors).toHaveProperty("callDate");
    expect((await add({ status: "NotInterested" })).fieldErrors).toHaveProperty("reason");
  });

  it("saves several numbers with their WhatsApp ticks, the referrer, and books the call back", async () => {
    as(users.arun);
    const r = await add({ mobile: [num(2), num(3)], whatsApp: ["1"], source: "Referral", referrerName: "Rajesh Kumar", status: "CallBack", callDate: tomorrow, callTime: "11:00" });
    expect(r.ok).toBe(true);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: r.id }, include: { mobiles: { orderBy: { sort: "asc" } }, calls: true } });
    expect([lead.name, lead.firstName, lead.gender, lead.status, lead.stage, lead.referrerName, lead.mobile, lead.onWhatsApp])
      .toEqual(["Test Lead", "Test", "Female", "CallBack", "Lead", "Rajesh Kumar", num(2), false]);
    expect(lead.mobiles.map((m) => [m.number, m.isWhatsApp])).toEqual([[num(2), false], [num(3), true]]);
    expect(lead.calls).toHaveLength(1);
  });

  it("refuses a number already used by any lead, including a second number", async () => {
    as(users.arun);
    const seededSecond = await prisma.leadMobile.findFirstOrThrow({ where: { sort: 1 }, include: { lead: true } });
    const r = await add({ mobile: [num(4), seededSecond.number] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain(seededSecond.lead.leadNo);
    expect((await add({ mobile: [num(4), num(4)] })).error).toMatch(/twice/);
  });
});

describe("Edit lead", () => {
  it("corrects details and numbers, logs the change, and keeps other users out", async () => {
    as(users.arun);
    const r = await add({ mobile: [num(5)] });
    const edit = (o: Record<string, string | string[]>) => editLead({ ok: false }, form({ ...base, mobile: [num(5)], leadId: r.id!, ...o }));
    as(users.divya);
    expect((await edit({ firstName: "X" })).error).toMatch(/another user/);
    as(users.arun);
    expect((await edit({ firstName: "Teresa", mobile: [num(5), num(6)], whatsApp: ["0", "1"] })).ok).toBe(true);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: r.id }, include: { mobiles: true } });
    expect([lead.name, lead.mobiles.length]).toEqual(["Teresa Lead", 2]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: r.id, action: "Updated" } });
    expect((log.before as Record<string, string>).name).toBe("Test Lead");
    expect((log.after as Record<string, string>).name).toBe("Teresa Lead");
    // its own numbers aren't a duplicate of itself
    expect((await edit({ firstName: "Teresa", mobile: [num(6), num(5)] })).ok).toBe(true);
  });
});

describe("Status and calls", () => {
  it("Call back must have a call; Not interested closes the open calls", async () => {
    as(users.arun);
    const r = await add({ mobile: [num(7)] });
    expect((await updateLead({ ok: false }, form({ leadId: r.id!, status: "CallBack", note: "", callDate: "", callTime: "" }))).fieldErrors).toHaveProperty("callDate");
    expect((await updateLead({ ok: false }, form({ leadId: r.id!, status: "CallBack", note: "after salary", callDate: tomorrow, callTime: "10:00" }))).ok).toBe(true);
    expect(await prisma.call.count({ where: { leadId: r.id, outcome: null } })).toBe(1);
    expect((await updateLead({ ok: false }, form({ leadId: r.id!, status: "NotInterested", note: "", callDate: "", callTime: "" }))).fieldErrors).toHaveProperty("note");
    expect((await updateLead({ ok: false }, form({ leadId: r.id!, status: "NotInterested", note: "Bought elsewhere", callDate: "", callTime: "" }))).ok).toBe(true);
    expect(await prisma.call.count({ where: { leadId: r.id, outcome: null } })).toBe(0);
  });

  it("lead call outcomes: Interested may close without a next call; No answer needs one", async () => {
    as(users.arun);
    const r = await add({ mobile: [num(8)], status: "CallBack", callDate: tomorrow, callTime: "12:00" });
    const call = await prisma.call.findFirstOrThrow({ where: { leadId: r.id, outcome: null } });
    const save = (o: Record<string, string>) => saveCallOutcome({ ok: false }, form({ callId: call.id, note: "", reason: "", callDate: "", callTime: "", ...o }));
    expect((await save({ outcome: "Done" })).error).toMatch(/lead call/);
    expect((await save({ outcome: "NoAnswer" })).fieldErrors).toHaveProperty("callDate");
    expect((await save({ outcome: "Interested", note: "Will visit office" })).ok).toBe(true);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: r.id }, include: { calls: true } });
    expect(lead.status).toBe("Interested");
    expect(lead.calls.every((c) => c.outcome)).toBe(true);
  });

  it("renewal calls go to the policy owner and end with Done", async () => {
    const policy = await prisma.policy.findFirstOrThrow({ where: { status: "Active", ownerId: users.divya.id, renewals: { some: { status: { in: ["Due", "Overdue"] } } } } });
    as(users.arun);
    expect((await scheduleCall({ ok: false }, form({ kind: "policy", refId: policy.id, callDate: tomorrow, callTime: "10:30", note: "" }))).error).toMatch(/another user/);
    as(users.admin);
    expect((await scheduleCall({ ok: false }, form({ kind: "policy", refId: policy.id, callDate: tomorrow, callTime: "10:30", note: "Remind about due" }))).ok).toBe(true);
    const call = await prisma.call.findFirstOrThrow({ where: { policyId: policy.id, createdAt: { gte: started } } });
    expect(call.ownerId).toBe(users.divya.id);
    as(users.divya);
    const save = (o: Record<string, string>) => saveCallOutcome({ ok: false }, form({ callId: call.id, note: "", reason: "", callDate: "", callTime: "", ...o }));
    expect((await save({ outcome: "Interested" })).error).toMatch(/Done or No answer/);
    expect((await save({ outcome: "Done", note: "Paid at branch" })).ok).toBe(true);
  });

  it("a closed lead can't get a call; the stage only moves forward", async () => {
    as(users.arun);
    const r = await add({ mobile: [num(9)], status: "NotInterested", reason: "Not now" });
    expect((await scheduleCall({ ok: false }, form({ kind: "lead", refId: r.id!, callDate: tomorrow, callTime: "10:00", note: "" }))).error).toMatch(/closed/);
    await db.$transaction(async (tx) => {
      await advanceStage(tx, r.id!, "Proposal");
      await advanceStage(tx, r.id!, "Quotation"); // no step back
    });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: r.id } })).stage).toBe("Proposal");
  });
});

describe("Follow-ups", () => {
  it("tabs: a call due tomorrow is Upcoming; a call closed today is under Closed", async () => {
    as(users.arun);
    const r = await add({ mobile: [num(0)], status: "CallBack", callDate: tomorrow, callTime: "09:30" });
    const call = await prisma.call.findFirstOrThrow({ where: { leadId: r.id } });
    const up = await loadFollowUps(users.arun as SessionUser, { tab: "upcoming" });
    expect(up.rows.some((x) => x.id === call.id && x.forLabel.startsWith("Lead RR-"))).toBe(true);
    const before = (await loadFollowUps(users.arun as SessionUser, { tab: "closed" })).cards.closed;
    await saveCallOutcome({ ok: false }, form({ callId: call.id, outcome: "NotInterested", note: "", reason: "Has a policy", callDate: "", callTime: "" }));
    const closed = await loadFollowUps(users.arun as SessionUser, { tab: "closed" });
    expect(closed.rows.some((x) => x.id === call.id && x.outcome === "NotInterested")).toBe(true);
    expect(closed.cards.closed).toBe(before + 1);
    // Arun sees only his own calls
    expect(up.rows.every((x) => x.ownerName === users.arun.name)).toBe(true);
  });
});
