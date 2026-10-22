// Change set phase 2 – shared pieces: overdue in days/months, cash denomination everywhere cash moves,
// the "Other" dropdown rule. Rows it creates are removed afterwards.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, prisma } from "@/lib/db";
import { dropdownValues, resolveDropdown } from "@/lib/dropdowns";
import { D } from "@/lib/money";
import { overdueText } from "@/lib/overdue";
import { checkDenominations } from "@/lib/payment-options";

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

const { createExpense } = await import("@/app/(app)/expenses/actions");
const { createReceipt } = await import("@/app/(app)/receipts/actions");
const { depositOneRdReceipt } = await import("@/app/(app)/daybook/actions");
const { setDropdownActive } = await import("@/app/(app)/settings/money-actions");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const users: Record<string, U> = {};
const as = (u: string) => (session.user = users[u]);
const VENDOR = "Vitest Shared Vendor";
const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const notes = (o: Record<string, number>, coins = "") => JSON.stringify({ ...o, coins });
let cashId = "";
const receipts: string[] = [];
const deposits: string[] = [];

beforeAll(async () => {
  for (const username of ["arun", "admin"]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    users[username] = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
  }
  cashId = (await prisma.account.findFirstOrThrow({ where: { tenantId: users.arun.tenantId, type: "Cash" } })).id;
});

afterAll(async () => {
  const t = users.arun.tenantId;
  const expenses = await prisma.expense.findMany({ where: { vendor: { name: VENDOR } }, select: { id: true } });
  const sources = [...expenses.map((e) => e.id), ...receipts, ...deposits];
  await prisma.dayBookEntry.deleteMany({ where: { sourceId: { in: sources } } });
  await prisma.commission.updateMany({ where: { poDepositId: { in: deposits } }, data: { poDepositId: null } });
  await prisma.poDepositLine.deleteMany({ where: { poDepositId: { in: deposits } } });
  await prisma.poDeposit.deleteMany({ where: { id: { in: deposits } } });
  await prisma.commission.deleteMany({ where: { receiptId: { in: receipts } } });
  await prisma.messageLog.deleteMany({ where: { relatedId: { in: receipts } } });
  await prisma.receipt.deleteMany({ where: { id: { in: receipts } } });
  await prisma.expense.deleteMany({ where: { id: { in: expenses.map((e) => e.id) } } });
  await prisma.vendor.deleteMany({ where: { name: VENDOR } });
  await prisma.dropdownOption.deleteMany({ where: { tenantId: t, addedByStaff: true, value: { startsWith: "Vitest" } } });
  await prisma.dropdownOption.updateMany({ where: { tenantId: t, list: "expensePurpose", value: "Marketing" }, data: { active: true } });
  await prisma.auditLog.deleteMany({ where: { entity: "DropdownOption", summary: { contains: "Marketing" } } });
  await prisma.$disconnect();
});

describe("Overdue in days, then months and days", () => {
  it.each([[0, "0 days"], [1, "1 day"], [9, "9 days"], [30, "30 days"], [31, "1 month 1 day"], [35, "1 month 5 days"], [59, "1 month 29 days"], [60, "2 months"], [61, "2 months 1 day"], [65, "2 months 5 days"], [400, "13 months 10 days"]])(
    "%i days → %s", (days, text) => expect(overdueText(days)).toBe(text),
  );
});

describe("Cash denomination", () => {
  it("total must equal the cash amount", () => {
    expect(checkDenominations(notes({ "500": 2, "100": 1 }), new D(1100))).toEqual({ ok: { "500": 2, "100": 1, coins: "" } });
    expect(checkDenominations(notes({ "500": 2 }, "50.50"), new D("1050.50"))).toHaveProperty("ok");
    expect(checkDenominations(notes({ "500": 2 }), new D(1100))).toEqual({ error: expect.stringMatching(/adds up to ₹1,000/) });
    expect(checkDenominations("", new D(100))).toHaveProperty("error");
    expect(checkDenominations("not json", new D(100))).toHaveProperty("error");
    expect(checkDenominations(notes({ "500": -1 }), new D(-500))).toHaveProperty("error");
  });

  it("expense from office cash: refused without it; stored and put on the Day Book line", async () => {
    as("arun");
    const base = { expenseDate: today, category: "Stationery", description: "Files", notes: "For the counter", amount: "650", vendor: VENDOR, paidBy: "Company", paidByName: "", mode: "Cash", fromAccount: cashId };
    expect((await createExpense({ ok: false }, form({ ...base, billNo: "VSH-1" }))).fieldErrors).toHaveProperty("denominations");
    expect((await createExpense({ ok: false }, form({ ...base, billNo: "VSH-1", denominations: notes({ "500": 1 }) }))).fieldErrors).toHaveProperty("denominations");
    const r = await createExpense({ ok: false }, form({ ...base, billNo: "VSH-1", denominations: notes({ "500": 1, "100": 1, "50": 1 }) }));
    expect(r.ok).toBe(true);
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: r.id } })).denominations).toEqual({ "500": 1, "100": 1, "50": 1, coins: "" });
    const line = await prisma.dayBookEntry.findFirstOrThrow({ where: { sourceId: r.id } });
    expect(line).toMatchObject({ accountId: cashId, direction: "Out", denominations: { "500": 1, "100": 1, "50": 1, coins: "" } });
  });

  it("RD money deposited at the post office from cash needs the notes, kept on the Day Book line", async () => {
    as("arun");
    const policy = await prisma.policy.findFirstOrThrow({ where: { policyNumber: "RD 2231-105" } });
    const rc = await createReceipt({ ok: false }, form({ customerId: policy.customerId, policyId: policy.id, amount: "200", mode: "Cash", reference: "", notes: "", slipIds: "", denominations: notes({ "100": 2 }) }));
    expect(rc.ok).toBe(true);
    receipts.push(rc.id!);
    const dep = { receiptId: rc.id!, paidOn: today, accountId: cashId, reference: "PO-VSH-1" };
    expect((await depositOneRdReceipt({ ok: false }, form(dep))).error).toMatch(/denomination/);
    expect(await depositOneRdReceipt({ ok: false }, form({ ...dep, denominations: notes({ "200": 1 }) }))).toEqual({ ok: true });
    const d = await prisma.poDeposit.findFirstOrThrow({ where: { poReceiptNo: "PO-VSH-1" } });
    deposits.push(d.id);
    expect((await prisma.dayBookEntry.findFirstOrThrow({ where: { sourceId: d.id } })).denominations).toEqual({ "200": 1, coins: "" });
  });
});

describe("'Other' rule", () => {
  const tx = <T,>(fn: Parameters<typeof db.$transaction>[0] extends (tx: infer X) => unknown ? (t: X) => Promise<T> : never) => db.$transaction(fn);

  it("picked values must be in the list; Other needs text; typed values are added once, tagged added by staff", async () => {
    const u = users.arun;
    expect(await tx((t) => resolveDropdown(t, u, "quotationCategory", "Health", ""))).toEqual({ value: "Health" });
    expect(await tx((t) => resolveDropdown(t, u, "quotationCategory", "Made up", ""))).toMatchObject({ error: expect.any(String), other: false });
    expect(await tx((t) => resolveDropdown(t, u, "quotationCategory", "Other", "   "))).toMatchObject({ other: true });
    expect(await tx((t) => resolveDropdown(t, u, "quotationCategory", "Other", "other"))).toMatchObject({ other: true });

    expect(await tx((t) => resolveDropdown(t, u, "quotationCategory", "Other", "Vitest  Travel  cover"))).toEqual({ value: "Vitest Travel cover" });
    expect(await tx((t) => resolveDropdown(t, u, "quotationCategory", "Other", "vitest travel COVER"))).toEqual({ value: "Vitest Travel cover" });
    const rows = await prisma.dropdownOption.findMany({ where: { tenantId: u.tenantId, list: "quotationCategory", value: { equals: "vitest travel cover", mode: "insensitive" } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ addedByStaff: true, createdById: u.id, active: true });
    expect(await dropdownValues(db, u.tenantId, "quotationCategory")).toContain("Vitest Travel cover");
  });

  it("expense with Other: saved with the typed purpose; a removed value stays off the list but can still be typed", async () => {
    as("arun");
    const base = { expenseDate: today, description: "Sweets", notes: "Diwali", amount: "300", vendor: VENDOR, paidBy: "Employee", paidByName: "Arun", mode: "Cash", fromAccount: "" };
    expect((await createExpense({ ok: false }, form({ ...base, billNo: "VSH-2", category: "Other", categoryOther: "" }))).fieldErrors).toHaveProperty("category");
    // A refused expense leaves no new value behind.
    const cashBase = { ...base, paidBy: "Company", paidByName: "", fromAccount: cashId };
    expect((await createExpense({ ok: false }, form({ ...cashBase, billNo: "VSH-9", category: "Other", categoryOther: "Vitest leak", denominations: notes({ "100": 1 }) }))).fieldErrors).toHaveProperty("denominations");
    expect(await dropdownValues(db, users.arun.tenantId, "expensePurpose")).not.toContain("Vitest leak");
    const r = await createExpense({ ok: false }, form({ ...base, billNo: "VSH-2", category: "Other", categoryOther: "Vitest festival" }));
    expect(r.ok).toBe(true);
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: r.id } })).category).toBe("Vitest festival");
    expect(await dropdownValues(db, users.arun.tenantId, "expensePurpose")).toContain("Vitest festival");

    as("admin");
    const marketing = await prisma.dropdownOption.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, list: "expensePurpose", value: "Marketing" } });
    expect(await setDropdownActive(marketing.id, false)).toEqual({ ok: true });
    as("arun");
    expect((await createExpense({ ok: false }, form({ ...base, billNo: "VSH-3", category: "Marketing" }))).fieldErrors).toHaveProperty("category");
    const typed = await createExpense({ ok: false }, form({ ...base, billNo: "VSH-3", category: "Other", categoryOther: "marketing" }));
    expect(typed.ok).toBe(true);
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: typed.id } })).category).toBe("Marketing");
    expect(await dropdownValues(db, users.arun.tenantId, "expensePurpose")).not.toContain("Marketing");
  });
});
