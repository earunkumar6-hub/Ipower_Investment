// Server-action tests against the seeded database; everything they change is put back.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

const { createExpense, approveExpense, rejectExpense, cancelExpense, repayExpense } = await import("@/app/(app)/expenses/actions");

const VENDOR = "Vitest Stationers";
const users: Record<string, U> = {};
const as = (u: string) => (session.user = users[u]);
// "From account" is an account id: the tests say "cash" / "bank" for office cash and the default bank.
const accountIds: Record<string, string> = {};
const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, k === "fromAccount" ? accountIds[v] ?? v : v));
  return f;
};
const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const base = { expenseDate: today, category: "Stationery", description: "Paper and pens", vendor: VENDOR, paidBy: "Company", paidByName: "", mode: "Cash", fromAccount: "cash", notes: "Vitest notes" };
let laptopId = "";

beforeAll(async () => {
  for (const username of ["arun", "divya", "admin", "superadmin"]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    users[username] = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
  }
  laptopId = (await prisma.expense.findFirstOrThrow({ where: { description: "Laptop" } })).id;
  for (const type of ["Cash", "Bank"] as const) {
    accountIds[type.toLowerCase()] = (await prisma.account.findFirstOrThrow({ where: { tenantId: users.arun.tenantId, type, isDefault: true } })).id;
  }
});

afterAll(async () => {
  const mine = await prisma.expense.findMany({ where: { vendor: { name: VENDOR } }, select: { id: true } });
  const ids = [...mine.map((e) => e.id), laptopId];
  await prisma.dayBookEntry.deleteMany({ where: { sourceId: { in: ids }, reversalOfId: { not: null } } });
  await prisma.dayBookEntry.deleteMany({ where: { sourceId: { in: ids } } });
  await prisma.expense.deleteMany({ where: { id: { in: mine.map((e) => e.id) } } });
  await prisma.vendor.deleteMany({ where: { name: VENDOR } });
  const { rm } = await import("node:fs/promises");
  for (const e of mine) await rm(`storage/bills/${e.id}.png`, { force: true });
  await prisma.expense.update({ where: { id: laptopId }, data: { status: "Waiting", approvedById: null, approvedAt: null } });
  await prisma.$disconnect();
});

const entries = (id: string) => prisma.dayBookEntry.findMany({ where: { sourceId: id }, include: { account: true }, orderBy: { createdAt: "asc" } });

describe("Expenses", () => {
  it("step 5–6: ₹3,200 waits for Admin, duplicate bill refused, Admin approves → cash out", async () => {
    as("arun");
    const r = await createExpense({ ok: false }, form({ ...base, amount: "3200", billNo: "vt-1045" }));
    expect(r).toMatchObject({ ok: true });
    let e = await prisma.expense.findUniqueOrThrow({ where: { id: r.id } });
    expect([e.status, e.approvalLevel, e.billNo]).toEqual(["Waiting", "Admin", "VT-1045"]);
    expect(await entries(e.id)).toHaveLength(0);

    // Same bill, same vendor (different case) → refused
    const dup = await createExpense({ ok: false }, form({ ...base, amount: "1600", billNo: "VT-1045", vendor: VENDOR.toLowerCase() }));
    expect(dup.ok).toBe(false);
    expect(dup.error).toMatch(/already entered/);

    // Staff can't approve; Admin can
    await expect(approveExpense(e.id)).rejects.toThrow(/Expense.Approve/);
    as("admin");
    expect(await approveExpense(e.id)).toEqual({ ok: true });
    e = await prisma.expense.findUniqueOrThrow({ where: { id: e.id } });
    expect(e.status).toBe("Approved");
    const [out] = await entries(e.id);
    expect([out.direction, out.amount.toFixed(2), out.account.name, out.entryType]).toEqual(["Out", "3200.00", "Cash", "Expense"]);
  });

  it("≤ ₹2,000 is saved and paid at once", async () => {
    as("divya");
    const r = await createExpense({ ok: false }, form({ ...base, amount: "450", billNo: "VT-2" }));
    const e = await prisma.expense.findUniqueOrThrow({ where: { id: r.id } });
    expect([e.status, e.approvalLevel]).toEqual(["Saved", "None"]);
    expect(await entries(e.id)).toHaveLength(1);
  });

  it("an Admin's own ₹4,800 goes to the Super Admin; Admin can't approve it", async () => {
    as("admin");
    const r = await createExpense({ ok: false }, form({ ...base, amount: "4800", billNo: "VT-3", fromAccount: "bank", mode: "UPI" }));
    const e = await prisma.expense.findUniqueOrThrow({ where: { id: r.id } });
    expect(e.approvalLevel).toBe("SuperAdmin");
    expect((await approveExpense(e.id)).ok).toBe(false);
    as("superadmin");
    expect(await approveExpense(e.id)).toEqual({ ok: true });
  });

  it("step 10: Owner approves the ₹38,000 laptop → SBI out", async () => {
    as("admin");
    expect((await approveExpense(laptopId)).ok).toBe(false);
    as("superadmin");
    expect(await approveExpense(laptopId)).toEqual({ ok: true });
    const [out] = await entries(laptopId);
    expect([out.amount.toFixed(2), out.account.name]).toEqual(["38000.00", "SBI current ••1234"]);
  });

  it("employee-paid: no money moves until repaid", async () => {
    as("arun");
    const r = await createExpense({ ok: false }, form({ ...base, amount: "350", billNo: "VT-4", paidBy: "Employee", paidByName: "Arun", fromAccount: "" }));
    const e = await prisma.expense.findUniqueOrThrow({ where: { id: r.id } });
    expect([e.status, e.repaymentStatus]).toEqual(["Saved", "ToBeRepaid"]);
    expect(await entries(e.id)).toHaveLength(0);
    await expect(repayExpense({ ok: false }, form({ expenseId: e.id, from: "cash" }))).rejects.toThrow();
    as("admin");
    expect(await repayExpense({ ok: false }, form({ expenseId: e.id, from: "cash" }))).toEqual({ ok: true });
    const [out] = await entries(e.id);
    expect([out.entryType, out.amount.toFixed(2)]).toEqual(["ExpenseRepayment", "350.00"]);
  });

  it("cancel: own only for staff; money that moved is reversed", async () => {
    as("divya");
    const r = await createExpense({ ok: false }, form({ ...base, amount: "999", billNo: "VT-5" }));
    as("arun");
    expect((await cancelExpense({ ok: false }, form({ expenseId: r.id!, reason: "not mine" }))).ok).toBe(false);
    as("divya");
    expect(await cancelExpense({ ok: false }, form({ expenseId: r.id!, reason: "entered twice" }))).toEqual({ ok: true });
    expect((await entries(r.id!)).map((x) => x.direction)).toEqual(["Out", "In"]);
  });

  it("accepts the form as the browser sends it (no employee field for company-paid) and stores the bill", async () => {
    as("arun");
    const f = form({ ...base, amount: "1200", billNo: "VT-7" });
    f.delete("paidByName");
    f.set("bill", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "bill.png", { type: "image/png" }));
    const r = await createExpense({ ok: false }, f);
    expect(r).toMatchObject({ ok: true });
    const e = await prisma.expense.findUniqueOrThrow({ where: { id: r.id } });
    expect(e.billPhotoPath).toBe(`${e.id}.png`);
    const { readBill } = await import("@/lib/bill-storage");
    expect((await readBill(e.billPhotoPath!)).type).toBe("image/png");

    const bad = form({ ...base, amount: "100", billNo: "VT-8" });
    bad.set("bill", new File(["x"], "bill.exe", { type: "application/x-msdownload" }));
    expect((await createExpense({ ok: false }, bad)).error).toMatch(/JPG, PNG, WEBP photo or a PDF/);
  });

  it("reject needs the right approver and a reason", async () => {
    as("arun");
    const r = await createExpense({ ok: false }, form({ ...base, amount: "2500", billNo: "VT-6" }));
    as("admin");
    expect((await rejectExpense({ ok: false }, form({ expenseId: r.id!, reason: "" }))).ok).toBe(false);
    expect(await rejectExpense({ ok: false }, form({ expenseId: r.id!, reason: "No bill attached" }))).toEqual({ ok: true });
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("Rejected");
  });
});
