// Phase 1 (Oct 2026 change round 2): Settings → Products and schemes, premature closure / MF withdrawal,
// Other income in the Day Book and P&L, and the change log behind all of them.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addMonths, isoDate, istToday } from "@/lib/dates";
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

const { saveProduct, saveScheme, addRate, addCustomField, removeCustomField } = await import("@/app/(app)/settings/actions");
const { closePolicy } = await import("@/app/(app)/customers/actions");
const { recordOtherIncome } = await import("@/app/(app)/daybook/actions");
const { loadRenewals } = await import("@/lib/renewals");
const { monthKey, monthRange, profitAndLoss } = await import("@/lib/pnl");
const { rateOn } = await import("@/lib/products");

const started = new Date();
const today = istToday();
const users: Record<"admin" | "arun" | "divya", U> = {} as never;
const NAME = "Test Product P1";
// Policies changed by the closure tests, restored afterwards.
const restore: { policyId: string; items: { id: string; status: "Due" | "Overdue" }[] }[] = [];

const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const as = (u: U) => { session.user = u; };
const productForm = (o: Record<string, string | string[]> = {}) => form({
  name: NAME, productType: "PoTd", partner: "Post Office", invoiceRule: "None", payModes: ["OneTime"], lockInMonths: "6",
  fields: ["policyNumber", "commencement"], requiredFields: ["policyNumber"], prematureClosure: "on", active: "on", ...o,
});

beforeAll(async () => {
  for (const k of ["admin", "arun", "divya"] as const) {
    const u = await prisma.user.findFirstOrThrow({ where: { username: k } });
    users[k] = { id: u.id, name: u.name, username: k, role: u.role, tenantId: u.tenantId };
  }
});

afterAll(async () => {
  const products = await prisma.product.findMany({ where: { name: NAME }, select: { id: true } });
  const ids = products.map((p) => p.id);
  await prisma.schemeRate.deleteMany({ where: { scheme: { productId: { in: ids } } } });
  await prisma.scheme.deleteMany({ where: { productId: { in: ids } } });
  await prisma.productCustomField.deleteMany({ where: { productId: { in: ids } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
  for (const r of restore) {
    await prisma.policy.update({ where: { id: r.policyId }, data: { status: "Active", closedOn: null, closeReason: null } });
    for (const i of r.items) await prisma.renewalItem.update({ where: { id: i.id }, data: { status: i.status } });
  }
  await prisma.dayBookEntry.deleteMany({ where: { entryType: "OtherIncome", createdAt: { gte: started } } });
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.$disconnect();
});

describe("Settings → Products and schemes", () => {
  it("only Admin and Super Admin can change products", async () => {
    as(users.arun);
    await expect(saveProduct({ ok: false }, productForm())).rejects.toThrow("Not allowed: Settings.Edit");
  });

  it("refuses inconsistent rules", async () => {
    as(users.admin);
    expect((await saveProduct({ ok: false }, productForm({ requiredFields: ["nominee"] }))).error).toMatch(/required field must also be shown/);
    expect((await saveProduct({ ok: false }, productForm({ invoiceRule: "UntilMaturity" }))).error).toMatch(/needs a pay mode other than one-time/);
    expect((await saveProduct({ ok: false }, productForm({ bankDetailsRequired: "on" }))).error).toMatch(/Tick the bank fields/);
    expect((await saveProduct({ ok: false }, productForm({ payModes: [] }))).error).toMatch(/at least one pay mode/);
  });

  it("adds a product, logs it, refuses a duplicate and logs only what changed", async () => {
    as(users.admin);
    const r = await saveProduct({ ok: false }, productForm());
    expect(r.ok).toBe(true);
    const p = await prisma.product.findUniqueOrThrow({ where: { id: r.id } });
    expect([p.lockInMonths, p.prematureClosure, p.bankFields]).toEqual([6, true, []]);
    const created = await prisma.auditLog.findFirstOrThrow({ where: { entityId: p.id, action: "Created" } });
    expect(created.userId).toBe(users.admin.id);

    expect((await saveProduct({ ok: false }, productForm())).error).toMatch(/already has a product named/);

    expect((await saveProduct({ ok: false }, productForm({ id: p.id, lockInMonths: "12" }))).ok).toBe(true);
    const updated = await prisma.auditLog.findFirstOrThrow({ where: { entityId: p.id, action: "Updated" } });
    expect([updated.before, updated.after]).toEqual([{ lockIn: "6 months" }, { lockIn: "1 year" }]);
  });

  it("mutual funds are never closed early", async () => {
    as(users.admin);
    const p = await prisma.product.findFirstOrThrow({ where: { name: NAME } });
    await saveProduct({ ok: false }, productForm({ id: p.id, productType: "MutualFund", payModes: ["Monthly"] }));
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).prematureClosure).toBe(false);
    await saveProduct({ ok: false }, productForm({ id: p.id, lockInMonths: "12" })); // back to TD
  });

  it("keeps rate history: the rate in force depends on the date", async () => {
    as(users.admin);
    const p = await prisma.product.findFirstOrThrow({ where: { name: NAME } });
    expect((await saveScheme({ ok: false }, form({ productId: p.id, name: "TD 2 years", tenure: "2", tenureUnit: "years", rate: "7.0", effectiveFrom: "2026-04-01" }))).ok).toBe(true);
    const s = await prisma.scheme.findFirstOrThrow({ where: { productId: p.id } });
    expect(s.tenureMonths).toBe(24);
    expect((await saveScheme({ ok: false }, form({ productId: p.id, name: "TD 2 years", tenure: "", tenureUnit: "years", rate: "" }))).error).toMatch(/already has a scheme/);

    const next = isoDate(addMonths(today, 1));
    expect((await addRate({ ok: false }, form({ schemeId: s.id, rate: "7.25", effectiveFrom: next }))).ok).toBe(true);
    expect((await addRate({ ok: false }, form({ schemeId: s.id, rate: "7.30", effectiveFrom: next }))).error).toMatch(/already set/);
    const rates = await prisma.schemeRate.findMany({ where: { schemeId: s.id } });
    expect(rateOn(rates, today)?.rate.toFixed(2)).toBe("7.00"); // future rate not yet in force
    expect(rateOn(rates, addMonths(today, 2))?.rate.toFixed(2)).toBe("7.25");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: s.id, action: "Rate changed" } });
    expect(log.before).toEqual({ rate: "7.00%" });
  });

  it("custom dropdown fields need two values and can be removed", async () => {
    as(users.admin);
    const p = await prisma.product.findFirstOrThrow({ where: { name: NAME } });
    expect((await addCustomField({ ok: false }, form({ productId: p.id, label: "Branch", type: "Dropdown", options: "GPO" }))).error).toMatch(/at least two values/);
    expect((await addCustomField({ ok: false }, form({ productId: p.id, label: "Branch", type: "Dropdown", options: "GPO, Mylapore, GPO", required: "on" }))).ok).toBe(true);
    const f = await prisma.productCustomField.findFirstOrThrow({ where: { productId: p.id } });
    expect([f.options, f.required]).toEqual([["GPO", "Mylapore"], true]);
    expect((await removeCustomField(f.id)).ok).toBe(true);
    expect(await prisma.productCustomField.count({ where: { productId: p.id } })).toBe(0);
  });
});

describe("Premature closure and withdrawal", () => {
  it("closing early stops unpaid instalments, drops them from Renewals and is logged", async () => {
    // An insurance policy with an open instalment, owned by Arun or Divya.
    const item = await prisma.renewalItem.findFirstOrThrow({
      where: { status: { in: ["Due", "Overdue"] }, policy: { productType: "Insurance", status: "Active", product: { prematureClosure: true, lockInMonths: null } } },
      include: { policy: true },
    });
    const policy = item.policy;
    const open = await prisma.renewalItem.findMany({ where: { policyId: policy.id, status: { in: ["Due", "Overdue"] } } });
    restore.push({ policyId: policy.id, items: open.map((i) => ({ id: i.id, status: i.status as "Due" | "Overdue" })) });
    const owner = Object.values(users).find((u) => u.id === policy.ownerId)!;
    const other = owner.id === users.arun.id ? users.divya : users.arun;

    as(other);
    expect((await closePolicy({ ok: false }, form({ policyId: policy.id, kind: "close", closedOn: isoDate(today), reason: "Customer request" }))).error).toMatch(/another user/);
    as(owner);
    expect((await closePolicy({ ok: false }, form({ policyId: policy.id, kind: "close", closedOn: isoDate(today), reason: "" }))).error).toMatch(/reason/);
    expect((await closePolicy({ ok: false }, form({ policyId: policy.id, kind: "withdraw", closedOn: isoDate(today) }))).error).toMatch(/Only mutual funds/);
    expect((await closePolicy({ ok: false }, form({ policyId: policy.id, kind: "close", closedOn: isoDate(today), reason: "Customer needed the money" }))).ok).toBe(true);

    const after = await prisma.policy.findUniqueOrThrow({ where: { id: policy.id }, include: { renewals: true } });
    expect(after.status).toBe("PrematureClosed");
    expect(after.renewals.filter((r) => open.some((o) => o.id === r.id)).every((r) => r.status === "Stopped")).toBe(true);
    for (const tab of ["due", "overdue"]) {
      const rows = (await loadRenewals(owner as SessionUser, { tab }, today)).rows;
      expect(rows.some((r) => r.policy.id === policy.id)).toBe(false);
    }
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: policy.id, action: "Closed early" } });
    expect(log.reason).toBe("Customer needed the money");
    expect((await closePolicy({ ok: false }, form({ policyId: policy.id, kind: "close", closedOn: isoDate(today), reason: "again" }))).error).toMatch(/already closed early/);
  });

  it("refuses closure inside the lock-in period", async () => {
    // Post office TD opened this month; the TD product has a 6-month lock-in.
    const td = await prisma.policy.findFirstOrThrow({ where: { productType: "PoTd", status: "Active", startDate: { gt: addMonths(today, -6) }, product: { lockInMonths: { not: null } } } });
    as(Object.values(users).find((u) => u.id === td.ownerId) ?? users.admin);
    expect((await closePolicy({ ok: false }, form({ policyId: td.id, kind: "close", closedOn: isoDate(today), reason: "Need money" }))).error).toMatch(/Lock-in runs until/);
  });

  it("mutual funds are withdrawn with a date, not closed early", async () => {
    const mf = await prisma.policy.findFirstOrThrow({ where: { productType: "MutualFund", status: "Active" } });
    const open = await prisma.renewalItem.findMany({ where: { policyId: mf.id, status: { in: ["Due", "Overdue"] } } });
    restore.push({ policyId: mf.id, items: open.map((i) => ({ id: i.id, status: i.status as "Due" | "Overdue" })) });
    as(users.admin);
    expect((await closePolicy({ ok: false }, form({ policyId: mf.id, kind: "close", closedOn: isoDate(today), reason: "x" }))).error).toMatch(/withdrawn, not closed early/);
    expect((await closePolicy({ ok: false }, form({ policyId: mf.id, kind: "withdraw", closedOn: isoDate(addMonths(today, 1)) }))).error).toMatch(/future/);
    expect((await closePolicy({ ok: false }, form({ policyId: mf.id, kind: "withdraw", closedOn: isoDate(today) }))).ok).toBe(true);
    const after = await prisma.policy.findUniqueOrThrow({ where: { id: mf.id } });
    expect([after.status, after.closedOn?.getTime()]).toEqual(["Withdrawn", today.getTime()]);
  });
});

describe("Other income", () => {
  it("is Admin-only, needs a reason and counts in P&L", async () => {
    const bank = await prisma.account.findFirstOrThrow({ where: { type: "Bank" } });
    const range = monthRange(monthKey(today));
    const before = await profitAndLoss(users.admin.tenantId, range);

    as(users.arun);
    await expect(recordOtherIncome({ ok: false }, form({ date: isoDate(today), amount: "1500", accountId: bank.id, reason: "Interest" }))).rejects.toThrow("Not allowed");
    as(users.admin);
    expect((await recordOtherIncome({ ok: false }, form({ date: isoDate(today), amount: "1500", accountId: bank.id, reason: "" }))).error).toMatch(/what this income is for/);
    expect((await recordOtherIncome({ ok: false }, form({ date: isoDate(today), amount: "1500", accountId: bank.id, reason: "SBI savings interest" }))).ok).toBe(true);

    const after = await profitAndLoss(users.admin.tenantId, range);
    expect(after.otherIncome.minus(before.otherIncome).toFixed(2)).toBe("1500.00");
    expect(after.profit.minus(before.profit).toFixed(2)).toBe("1500.00");
    const entry = await prisma.dayBookEntry.findFirstOrThrow({ where: { entryType: "OtherIncome", createdAt: { gte: started } } });
    expect([entry.direction, entry.isPassThrough, entry.accountId]).toEqual(["In", false, bank.id]);
    expect(await prisma.auditLog.count({ where: { entity: "DayBook", action: "Other income", createdAt: { gte: started } } })).toBe(1);
  });
});
