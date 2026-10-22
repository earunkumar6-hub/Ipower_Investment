// Change set phase 5 – Day Book: ATM withdrawal, deposit to bank, owner withdrawal / contribution, grace period.
// Runs against the seeded database; every row it creates is removed afterwards.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, isoDate, istToday } from "@/lib/dates";
import { db, prisma, type Tx } from "@/lib/db";
import { daysPastGrace, graceBadge, graceState } from "@/lib/daybook-grace";
import { loadDayBook } from "@/lib/daybook-view";
import { hasPermission } from "@/lib/permissions";
import { monthKey, monthRange, ownerStatement, profitAndLoss } from "@/lib/pnl";

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

const { recordAtmWithdrawal, depositToBank, recordOwnerEntry, decideOwnerEntry, closeDayBook } = await import("@/app/(app)/daybook/actions");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const notes = (amount: number) => JSON.stringify({ "500": Math.floor(amount / 500), coins: (amount % 500).toFixed(2) });
const users: Record<string, U> = {};
const as = (u: string) => (session.user = users[u]);
const today = istToday();
const date = isoDate(today);
const started = new Date();
let bank = "", cash = "";
const ownerIds: string[] = [];
const testEntries: string[] = [];

beforeAll(async () => {
  for (const username of ["arun", "admin", "superadmin"]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    users[username] = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
  }
  bank = (await prisma.account.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, type: "Bank", isDefault: true } })).id;
  cash = (await prisma.account.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, type: "Cash" } })).id;
});

afterAll(async () => {
  await prisma.dayBookEntry.deleteMany({ where: { createdAt: { gte: started }, reversalOfId: { not: null } } });
  await prisma.dayBookEntry.deleteMany({ where: { OR: [{ id: { in: testEntries } }, { createdAt: { gte: started }, OR: [{ sourceType: "Contra", sourceNo: { startsWith: "VT5-" } }, { sourceId: { in: ownerIds } }] }] } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ownerIds } } });
  await prisma.ownerEntry.deleteMany({ where: { id: { in: ownerIds } } });
  await prisma.$disconnect();
});

describe("ATM withdrawal (#9)", () => {
  const atm = (o: Record<string, string> = {}) =>
    form({ date, bankAccountId: bank, amount: "1500", reference: "VT5-ATM", withdrawnById: users.arun.id, reason: "Cash for RD", denominations: notes(1500), ...o });

  it("needs the transaction no., who withdrew it, an active bank account and notes adding up", async () => {
    as("arun");
    expect((await recordAtmWithdrawal({ ok: false }, atm({ reference: "" }))).error).toMatch(/transaction number/);
    expect((await recordAtmWithdrawal({ ok: false }, atm({ withdrawnById: "" }))).error).toMatch(/who withdrew/);
    expect((await recordAtmWithdrawal({ ok: false }, atm({ bankAccountId: cash }))).error).toMatch(/active bank account/);
    expect((await recordAtmWithdrawal({ ok: false }, atm({ denominations: notes(1000) }))).error).toMatch(/adds up to ₹1,000/);
  });

  it("posts bank out / cash in (one row in the Day Book list) with the notes on the cash line", async () => {
    as("arun");
    expect(await recordAtmWithdrawal({ ok: false }, atm())).toEqual({ ok: true });
    const lines = await prisma.dayBookEntry.findMany({ where: { sourceNo: "VT5-ATM", createdAt: { gte: started } } });
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.direction === "Out")).toMatchObject({ accountId: bank, entryType: "Withdrawal" });
    expect(lines.find((l) => l.direction === "In")).toMatchObject({ accountId: cash, entryType: "Withdrawal", denominations: { "500": 3, coins: "0.00" } });
    expect(lines[0].particulars).toContain("₹1,500 cash / ₹1,500 bank");
    expect(lines[0].particulars).toContain(`by ${users.arun.name}`);

    const d = await loadDayBook(users.admin, today);
    const rows = d.transactions.filter((t) => t.particulars.includes("VT5-ATM"));
    expect(rows).toHaveLength(1);
    expect(rows[0].account).toMatch(/→ Cash$/);
    expect(d.tally.lines.some((l) => l.label === "ATM withdrawal")).toBe(true);
  });
});

describe("Deposit to bank (#16)", () => {
  it("cash out, bank in – a transfer; refused beyond the cash in hand", async () => {
    as("arun");
    const f = (amount: number) => form({ date, bankAccountId: bank, amount: String(amount), reference: "VT5-DEP", denominations: notes(amount), notes: "" });
    expect((await depositToBank({ ok: false }, f(9_000_000))).error).toMatch(/Cash in hand is only/);
    expect((await depositToBank({ ok: false }, form({ date, bankAccountId: bank, amount: "1000", reference: "", denominations: notes(1000) }))).error).toMatch(/slip/);
    expect(await depositToBank({ ok: false }, f(1000))).toEqual({ ok: true });
    const lines = await prisma.dayBookEntry.findMany({ where: { sourceNo: "VT5-DEP", createdAt: { gte: started } } });
    expect(lines.find((l) => l.direction === "Out")).toMatchObject({ accountId: cash, entryType: "DepositToBank" });
    expect(lines.find((l) => l.direction === "In")).toMatchObject({ accountId: bank, entryType: "DepositToBank" });
  });
});

describe("Owner withdrawal and contribution (#19, #20)", () => {
  const owner = (o: Record<string, string>) => form({ date, accountId: cash, amount: "2000", reference: "", reason: "Vitest owner money", denominations: notes(2000), ...o });

  it("bank needs a transaction no.; cash needs the notes", async () => {
    as("arun");
    expect((await recordOwnerEntry({ ok: false }, owner({ kind: "Withdrawal", accountId: bank }))).error).toMatch(/transaction no/);
    expect((await recordOwnerEntry({ ok: false }, owner({ kind: "Withdrawal", denominations: "" }))).error).toMatch(/denomination/);
  });

  it("recorded Pending and in the Day Book at once; not in P&L; only the Super Admin confirms", async () => {
    const range = monthRange(monthKey(today));
    const before = await profitAndLoss(users.admin.tenantId, range);
    as("arun");
    expect(await recordOwnerEntry({ ok: false }, owner({ kind: "Withdrawal" }))).toEqual({ ok: true });
    expect(await recordOwnerEntry({ ok: false }, owner({ kind: "Contribution", accountId: bank, reference: "VT5-OWN", denominations: "" }))).toEqual({ ok: true });
    const entries = await prisma.ownerEntry.findMany({ where: { createdAt: { gte: started } }, orderBy: { createdAt: "asc" } });
    ownerIds.push(...entries.map((e) => e.id));
    const [w, c] = entries;
    expect(w).toMatchObject({ kind: "Withdrawal", status: "Pending", accountId: cash });
    expect(await prisma.dayBookEntry.findFirst({ where: { sourceId: w.id } })).toMatchObject({ direction: "Out", entryType: "OwnerWithdrawal", accountId: cash });
    expect(await prisma.dayBookEntry.findFirst({ where: { sourceId: c.id } })).toMatchObject({ direction: "In", entryType: "OwnerContribution", accountId: bank });

    const after = await profitAndLoss(users.admin.tenantId, range);
    expect(after.profit.toFixed(2)).toBe(before.profit.toFixed(2));

    as("admin");
    await expect(decideOwnerEntry({ ok: false }, form({ ownerEntryId: w.id, decision: "Confirm" }))).rejects.toThrow(/Not allowed/);
    as("superadmin");
    expect(await decideOwnerEntry({ ok: false }, form({ ownerEntryId: w.id, decision: "Confirm" }))).toEqual({ ok: true });
    expect((await decideOwnerEntry({ ok: false }, form({ ownerEntryId: w.id, decision: "Reject", reason: "late" }))).error).toMatch(/Already confirmed/);
    expect((await decideOwnerEntry({ ok: false }, form({ ownerEntryId: c.id, decision: "Reject", reason: "" }))).error).toMatch(/why/);
    expect(await decideOwnerEntry({ ok: false }, form({ ownerEntryId: c.id, decision: "Reject", reason: "Entered twice" }))).toEqual({ ok: true });
    const original = await prisma.dayBookEntry.findFirstOrThrow({ where: { sourceId: c.id, reversalOfId: null } });
    expect(await prisma.dayBookEntry.count({ where: { reversalOfId: original.id } })).toBe(1);

    const statement = await ownerStatement(users.admin.tenantId, range);
    expect(statement.entries.filter((e) => ownerIds.includes(e.id)).map((e) => e.status)).toEqual(["Confirmed", "Rejected"]);
    expect(statement.withdrawn.gte(2000)).toBe(true);
    expect(statement.entries.filter((e) => e.status !== "Rejected" && e.kind === "Contribution").every((e) => e.id !== c.id)).toBe(true);
  });
});

describe("Grace period (#10)", () => {
  it("counts grace days and locks after them", () => {
    expect(graceState(today, today, 3)).toEqual({ state: "today" });
    expect(graceBadge(graceState(addDays(today, -2), today, 3))).toBe("OPEN · grace day 2 of 3");
    expect(graceState(addDays(today, -3), today, 3)).toMatchObject({ state: "grace", day: 3 });
    expect(graceState(addDays(today, -4), today, 3)).toMatchObject({ state: "locked", daysLate: 4 });
  });

  it("only the Super Admin may close late", () => {
    expect(hasPermission("SuperAdmin", "DayBook.CloseLate")).toBe(true);
    expect(hasPermission("Admin", "DayBook.CloseLate")).toBe(false);
    expect(hasPermission("Admin", "Owner.Confirm")).toBe(false);
    expect(hasPermission("User", "DayBook.Close")).toBe(false);
  });

  it("an unclosed day past grace is listed; an Admin's close is refused, the Super Admin's passes the grace check", async () => {
    const tenantId = users.admin.tenantId;
    const old = addDays(today, -20);
    if (await prisma.dayClose.findFirst({ where: { tenantId, date: old, status: "Closed" } })) return; // seeded as closed: nothing to test here
    const e = await prisma.dayBookEntry.create({
      data: { tenantId, accountId: cash, entryDate: old, direction: "In", amount: 1, entryType: "Adjustment", sourceType: "Manual", particulars: "Vitest grace", idempotencyKey: `vt5-${started.getTime()}`, createdById: users.admin.id },
    });
    testEntries.push(e.id);
    const { dayCloseGraceDays } = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect((await daysPastGrace(db as unknown as Tx, tenantId, today, dayCloseGraceDays)).map(isoDate)).toContain(isoDate(old));

    as("admin");
    expect((await closeDayBook({ ok: false }, form({ date: isoDate(old) }))).error).toMatch(/grace period and is locked/);
    as("superadmin");
    expect((await closeDayBook({ ok: false }, form({ date: isoDate(old) }))).error ?? "").not.toMatch(/grace period/);
  });
});
