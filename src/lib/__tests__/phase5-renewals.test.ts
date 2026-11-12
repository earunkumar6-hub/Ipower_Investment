// Phase 5 (Oct 2026 round 2): Renewals date range, schedule rules per product, maturity reminders for every scheme,
// automatic Matured, Not renewed, reminder counts, by-customer view and the monthly renewal Excel.
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, addMonths, fmtDate, istToday } from "@/lib/dates";
import { prisma } from "@/lib/db";
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

const { pickRange, renewalRange } = await import("@/lib/lists");
const { billEnd, fullSchedule } = await import("@/lib/policies");
const { payableDues } = await import("@/lib/dues");
const { loadRenewals, refreshOverdue, renewalCards } = await import("@/lib/renewals");
const { markNotRenewed, reminderHistory, sendRenewalReminder, sendMaturityReminder } = await import("@/app/(app)/renewals/actions");
const { deactivatePolicy, deletePolicy, reactivatePolicy } = await import("@/app/(app)/customers/policy-actions");
const { REPORTS } = await import("@/lib/exports");

const started = new Date();
const today = istToday();
const D = (v: string) => new Prisma.Decimal(v);
let arun: U;
let rajesh = { id: "", ownerId: "" };
let seq = 0;
const policy = (data: Partial<Prisma.PolicyUncheckedCreateInput>) => prisma.policy.create({
  data: {
    tenantId: arun.tenantId, customerId: rajesh.id, ownerId: rajesh.ownerId, productType: "Insurance", partner: "LIC", productName: "Jeevan Anand",
    policyNumber: `T5-${Date.now() % 1e6}-${seq++}`, premiumAmount: "10000.00", frequency: "Yearly", startDate: today, ...data,
  },
});

beforeAll(async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { username: "arun" } });
  arun = { id: u.id, name: u.name, username: "arun", role: u.role, tenantId: u.tenantId };
  rajesh = await prisma.customer.findFirstOrThrow({ where: { name: "Rajesh Kumar" }, select: { id: true, ownerId: true } });
  session.user = arun;
});

afterAll(async () => {
  const ids = (await prisma.policy.findMany({ where: { createdAt: { gte: started } }, select: { id: true } })).map((p) => p.id);
  await prisma.renewalItem.deleteMany({ where: { policyId: { in: ids } } });
  await prisma.policy.deleteMany({ where: { id: { in: ids } } });
  await prisma.messageLog.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.$disconnect();
});

describe("Date range", () => {
  it("quick picks and tab defaults", () => {
    const wed = new Date("2026-10-21T00:00:00Z");
    expect(pickRange("week", wed)).toEqual({ from: new Date("2026-10-19T00:00:00Z"), to: new Date("2026-10-25T00:00:00Z") });
    expect(pickRange("lastmonth", wed)).toEqual({ from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-30T00:00:00Z") });
    expect(pickRange("next3m", wed)?.to).toEqual(new Date("2027-01-20T00:00:00Z"));
    expect(renewalRange("due", {}, wed)).toMatchObject({ from: wed, to: new Date("2026-11-19T00:00:00Z"), pick: "next30" });
    expect(renewalRange("paid", {}, wed)?.from).toEqual(new Date("2026-09-22T00:00:00Z"));
    expect(renewalRange("overdue", {}, wed)).toBeNull();
    expect(renewalRange("due", { within: "7" }, wed)?.to).toEqual(new Date("2026-10-27T00:00:00Z")); // old dashboard link
    expect(renewalRange("due", { from: "2026-12-01", to: "2026-12-31" }, wed)).toMatchObject({ pick: "custom", to: new Date("2026-12-31T00:00:00Z") });
  });
});

describe("Schedule rules", () => {
  const start = new Date("2025-03-04T00:00:00Z");
  const base = { startDate: start, premiumAmount: D("1000"), premiumPayingTermMonths: null };
  const renewals = (rows: { type: string }[]) => rows.filter((r) => r.type === "Renewal").length;

  it("follow the documents: Yearly × 3 years = 2 renewals, Monthly × 1 year = 11, RD stops the month before maturity", () => {
    expect(renewals(fullSchedule({ ...base, frequency: "Yearly", termMonths: 36, productType: "Insurance" }, "UntilPremiumTerm", [], today))).toBe(2);
    expect(renewals(fullSchedule({ ...base, frequency: "Monthly", termMonths: 12, productType: "Insurance" }, null, [], today))).toBe(11);
    const rd = fullSchedule({ ...base, frequency: "Monthly", termMonths: 60, productType: "PoRd" }, "UntilMaturity", [], today);
    expect(renewals(rd)).toBe(59);
    expect(rd.at(-1)).toMatchObject({ type: "Expiry", date: new Date("2030-03-04T00:00:00Z") });
  });

  it("premium paying term, one-time deposits and health", () => {
    expect(renewals(fullSchedule({ ...base, frequency: "Yearly", termMonths: 240, premiumPayingTermMonths: 180, productType: "Insurance" }, "UntilPremiumTerm", [], today))).toBe(14);
    const td = fullSchedule({ ...base, frequency: "OneTime", termMonths: 24, productType: "PoTd" }, "None", [], today);
    expect(td.map((r) => r.type)).toEqual(["First payment (at start)", "Maturity"]);
    expect(td[1].date).toEqual(new Date("2027-03-04T00:00:00Z")); // the spec's example: TD 2 years from 4 Mar 2025
    const health = { ...base, frequency: "Yearly" as const, termMonths: 12, productType: "Insurance" as const };
    expect(billEnd(health, "UntilClosed")).toBeNull();
    expect(fullSchedule(health, "UntilClosed", [], today).some((r) => r.type === "Expiry")).toBe(false);
  });

  it("advance payments never go past the bill rule", () => {
    const rd = { startDate: addMonths(today, -58), frequency: "Monthly" as const, termMonths: 60, premiumAmount: D("1000"), productType: "PoRd" as const };
    const dues = payableDues({ ...rd, billUntil: billEnd(rd, "UntilMaturity") }, [], today);
    expect(dues.every((d) => d.dueDate < addMonths(rd.startDate, 60))).toBe(true);
    // month 58 falls today, month 59 is the last bill; month 60 is maturity, so not billed
    expect(dues.map((d) => d.dueDate)).toEqual([addMonths(rd.startDate, 58), addMonths(rd.startDate, 59)]);
  });
});

describe("Maturity and lifecycle", () => {
  it("every scheme with a maturity is reminded a month before; health is not", async () => {
    const lic = await policy({ startDate: addDays(addMonths(today, -240), 20), termMonths: 240 });
    const care = await prisma.product.findFirstOrThrow({ where: { name: "Care Supreme" } });
    const health = await policy({ partner: "Care Health", productName: "Care Supreme", productId: care.id, startDate: addDays(addMonths(today, -12), 10), termMonths: 12 });
    // Maturities have their own tab (#20) and are no longer on Due.
    const rows = (await loadRenewals(arun as SessionUser, { tab: "maturity" }, today)).rows;
    expect(rows.some((r) => r.kind === "maturity" && r.policy.id === lic.id)).toBe(true);
    expect(rows.some((r) => r.kind === "maturity" && r.policy.id === health.id)).toBe(false);
    expect((await loadRenewals(arun as SessionUser, { tab: "due" }, today)).rows.some((r) => r.kind === "maturity")).toBe(false);
    expect((await sendMaturityReminder(lic.id)).ok).toBe(true);
    expect(await prisma.messageLog.count({ where: { relatedId: lic.id, template: "maturity_reminder" } })).toBe(1);
    // The row shows the reminder (#24): count, last date and channel, with the full history behind it.
    const row = (await loadRenewals(arun as SessionUser, { tab: "maturity" }, today)).rows.find((r) => r.policy.id === lic.id)!;
    expect([row.reminderCount, row.lastReminderChannel, !!row.lastReminderAt]).toEqual([1, "WhatsApp", true]);
    const history = await reminderHistory("maturity", lic.id);
    expect(history.lines?.map((l) => [l.channel, l.by])).toEqual([["WhatsApp", arun.name]]);
  });

  it("a billed policy past maturity with nothing unpaid becomes Matured; with an unpaid instalment it stays Active", async () => {
    const done = await policy({ productType: "PoRd", partner: "Post Office", productName: "RD", frequency: "Monthly", premiumAmount: "500.00", startDate: addMonths(today, -61), termMonths: 60 });
    const owing = await policy({ productType: "PoRd", partner: "Post Office", productName: "RD", frequency: "Monthly", premiumAmount: "500.00", startDate: addMonths(today, -61), termMonths: 60 });
    await prisma.renewalItem.create({ data: { tenantId: arun.tenantId, policyId: owing.id, dueDate: addMonths(today, -2), premiumAmount: "500.00", status: "Overdue" } });
    await refreshOverdue(arun.tenantId, today);
    const [a, b] = await Promise.all([prisma.policy.findUniqueOrThrow({ where: { id: done.id } }), prisma.policy.findUniqueOrThrow({ where: { id: owing.id } })]);
    expect([a.status, a.closedOn?.getTime()]).toEqual(["Matured", addMonths(done.startDate, 60).getTime()]);
    expect(b.status).toBe("Active");
  });
});

describe("Reminders and Not renewed", () => {
  it("reminders are counted; Not renewed lapses the policy and stops reminders", async () => {
    const p = await policy({ startDate: addMonths(today, -14) });
    const item = await prisma.renewalItem.create({ data: { tenantId: arun.tenantId, policyId: p.id, dueDate: addMonths(today, -2), premiumAmount: "10000.00", status: "Overdue" } });
    expect((await sendRenewalReminder(item.id)).ok).toBe(true);
    expect((await sendRenewalReminder(item.id)).ok).toBe(true);
    expect((await prisma.renewalItem.findUniqueOrThrow({ where: { id: item.id } })).reminderCount).toBe(2);
    const overdue = await loadRenewals(arun as SessionUser, { tab: "overdue" }, today);
    expect(overdue.rows.find((r) => r.id === item.id)?.reminderCount).toBe(2);

    expect((await markNotRenewed(item.id, "")).error).toMatch(/why/);
    expect((await markNotRenewed(item.id, "Moved to another insurer")).ok).toBe(true);
    const after = await prisma.policy.findUniqueOrThrow({ where: { id: p.id }, include: { renewals: true } });
    expect([after.status, after.closeReason, after.renewals[0].status]).toEqual(["Lapsed", "Moved to another insurer", "Lapsed"]);
    expect((await sendRenewalReminder(item.id)).ok).toBe(false);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { entityId: p.id, action: "Not renewed" } })).reason).toBe("Moved to another insurer");
  });
});

describe("Deactivate, switch back on, delete a product (#25)", () => {
  const as = async (username: string) => {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    session.user = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
  };

  it("deactivate stops bills and reminders; switching back on makes them due again", async () => {
    const p = await policy({ startDate: addMonths(today, -14) });
    const late = await prisma.renewalItem.create({ data: { tenantId: arun.tenantId, policyId: p.id, dueDate: addMonths(today, -2), premiumAmount: "10000.00", status: "Overdue" } });
    const next = await prisma.renewalItem.create({ data: { tenantId: arun.tenantId, policyId: p.id, dueDate: addMonths(today, 10), premiumAmount: "10000.00", status: "Due" } });
    try {
      await expect(deactivatePolicy(p.id, "Customer asked to stop")).rejects.toThrow(/Not allowed/); // a User can't
      await as("admin");
      expect((await deactivatePolicy(p.id, "")).error).toMatch(/why/);
      expect(await deactivatePolicy(p.id, "Customer asked to stop")).toEqual({ ok: true });
      const off = await prisma.policy.findUniqueOrThrow({ where: { id: p.id }, include: { renewals: { orderBy: { dueDate: "asc" } } } });
      expect([off.status, off.closeReason, ...off.renewals.map((r) => r.status)]).toEqual(["Deactivated", "Customer asked to stop", "Stopped", "Stopped"]);
      expect((await sendRenewalReminder(late.id)).ok).toBe(false);
      expect((await loadRenewals(session.user as SessionUser, { tab: "overdue" }, today)).rows.some((r) => r.id === late.id)).toBe(false);
      expect((await deactivatePolicy(p.id, "again")).error).toMatch(/Only an active/);

      expect(await reactivatePolicy(p.id)).toEqual({ ok: true });
      const on = await prisma.policy.findUniqueOrThrow({ where: { id: p.id } });
      expect([on.status, on.closeReason]).toEqual(["Active", null]);
      const [a, b] = await Promise.all([prisma.renewalItem.findUniqueOrThrow({ where: { id: late.id } }), prisma.renewalItem.findUniqueOrThrow({ where: { id: next.id } })]);
      expect([a.status, b.status]).toEqual(["Overdue", "Due"]);
      expect(await prisma.auditLog.count({ where: { entityId: p.id, action: { in: ["Deactivated", "Reactivated"] } } })).toBe(2);
    } finally {
      session.user = arun;
    }
  });

  it("only the Super Admin deletes, only with DELETE typed and no money records", async () => {
    const p = await policy({ startDate: addMonths(today, -2) });
    await prisma.renewalItem.create({ data: { tenantId: arun.tenantId, policyId: p.id, dueDate: addMonths(today, 10), premiumAmount: "10000.00", status: "Due" } });
    const withReceipt = await prisma.policy.findFirstOrThrow({ where: { tenantId: arun.tenantId, receipts: { some: {} } } });
    try {
      await as("admin");
      await expect(deletePolicy(p.id, "DELETE")).rejects.toThrow(/Not allowed/);
      await as("superadmin");
      expect((await deletePolicy(p.id, "delete it")).error).toMatch(/Type DELETE/);
      expect((await deletePolicy(withReceipt.id, "DELETE")).error).toMatch(/receipt.*can't be deleted – deactivate it instead/);
      expect(await deletePolicy(p.id, "delete")).toEqual({ ok: true });
      expect(await prisma.policy.count({ where: { id: p.id } })).toBe(0);
      expect(await prisma.renewalItem.count({ where: { policyId: p.id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { entityId: p.id, action: "Deleted" } })).toBe(1);
    } finally {
      session.user = arun;
    }
  });
});

describe("Summary, by customer, monthly Excel", () => {
  it("cards add up and by customer lists overdue first", async () => {
    const f = await loadRenewals(arun as SessionUser, { tab: "customers" }, today);
    const cards = await renewalCards(arun.tenantId, f.policyWhere, today);
    expect(cards.due.count).toBe(cards.paid.count + cards.notPaid.count);
    expect(f.customers.length).toBeGreaterThan(0);
    const owed = f.customers.map((c) => Number(c.overdue.plus(c.ownerPaidOwed)));
    expect(owed).toEqual([...owed].sort((a, b) => b - a));
    expect(f.customers.every((c) => c.policies.length > 0)).toBe(true);
  });

  it("the renewal Excel has last month (renewed or not) and this month's dues", async () => {
    const built = await REPORTS["renewal-month"].build(arun as SessionUser, {});
    expect(built!.sheets.map((s) => s.name)).toEqual(["Last month", "This month due"]);
    expect(built!.file).toBe(`renewals-month-${fmtDate(today).slice(3).replace("/", "-")}.xlsx`);
  });
});
