// Day Book flow (demo steps 8–9) through the real server actions, on today's seeded data.
// Everything created is removed afterwards, so today is open again for the demo.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { accountDay } from "@/lib/daybook";
import { istToday, isoDate } from "@/lib/dates";
import { db, prisma, type Tx } from "@/lib/db";
import { sum, ZERO } from "@/lib/money";

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

const { recordAtmWithdrawal, depositToPostOffice, saveCashCount, saveVerification, closeDayBook } = await import("@/app/(app)/daybook/actions");
const { approveExpense, markExpensePaid, cancelExpense } = await import("@/app/(app)/expenses/actions");
const { createReceipt } = await import("@/app/(app)/receipts/actions");

const today = istToday();
const date = isoDate(today);
const started = new Date();
const users: Record<string, U> = {};
const as = (u: string) => (session.user = users[u]);
/** Cash needs a denomination that adds up: ₹500 notes, the rest in coins. */
const cashFor = (amount: string) => JSON.stringify({ "500": Math.floor(Number(amount) / 500), coins: (Number(amount) % 500).toFixed(2) });
const form = (o: Record<string, string>) => {
  const f = new FormData();
  const withCash = o.mode === "Cash" && o.denominations === undefined && o.amount ? { ...o, denominations: cashFor(o.amount) } : o;
  Object.entries(withCash).forEach(([k, v]) => f.set(k, v));
  return f;
};
let collectedIds: string[] = [];
let existingCloses: string[] = [];
let laptopId = "";
let printerId = "";

beforeAll(async () => {
  for (const username of ["arun", "admin", "superadmin"]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    users[username] = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
  }
  collectedIds = (await prisma.receipt.findMany({ where: { rdStatus: "Collected", status: "Saved", ownerPaid: false } })).map((r) => r.id);
  existingCloses = (await prisma.dayClose.findMany({ where: { date: today } })).map((c) => c.id);
  if (existingCloses.length) throw new Error("Today is already being counted/closed in the app; reseed before running these tests");
  laptopId = (await prisma.expense.findFirstOrThrow({ where: { description: "Laptop" } })).id;
  printerId = (await prisma.expense.findFirstOrThrow({ where: { description: "Printer repair" } })).id;
});

afterAll(async () => {
  // Only what these tests created: today's close rows, their ATM entry and their deposit.
  await prisma.dayClose.deleteMany({ where: { date: today, id: { notIn: existingCloses } } });
  const deposits = await prisma.poDeposit.findMany({ where: { createdAt: { gte: started }, poReceiptNo: "7781 2290" }, select: { id: true } });
  const depositIds = deposits.map((d) => d.id);
  await prisma.dayBookEntry.deleteMany({
    where: { createdAt: { gte: started }, OR: [{ sourceType: "Contra", notes: "for UPI-paid RD" }, { sourceId: { in: depositIds } }] },
  });
  await prisma.expense.update({ where: { id: laptopId }, data: { status: "Waiting", approvedById: null, approvedAt: null } });
  await prisma.expense.update({ where: { id: printerId }, data: { status: "Waiting", cancelReason: null } });
  await prisma.commission.updateMany({ where: { poDepositId: { in: depositIds } }, data: { poDepositId: null } });
  await prisma.poDepositLine.deleteMany({ where: { poDepositId: { in: depositIds } } });
  await prisma.poDeposit.deleteMany({ where: { id: { in: depositIds } } });
  await prisma.receipt.updateMany({ where: { id: { in: collectedIds } }, data: { rdStatus: "Collected" } });
  await prisma.$disconnect();
});

/** ATM withdrawal form: default bank, a transaction no., withdrawn by Arun, notes adding up. */
const atmForm = async (amount: string, reason = "for UPI-paid RD") => {
  const bank = await prisma.account.findFirstOrThrow({ where: { type: "Bank", isDefault: true } });
  return form({ date, bankAccountId: bank.id, amount, reference: "ATM-VT-1", withdrawnById: users.arun.id, reason, denominations: cashFor(amount) });
};

const cashDay = async () => {
  const cash = await prisma.account.findFirstOrThrow({ where: { type: "Cash" } });
  return (await accountDay(db as unknown as Tx, users.admin.tenantId, today)).find((d) => d.accountId === cash.id)!;
};

describe("Day Book: ATM, PO deposit, tally, verify, close", () => {
  it("deposit needs a reason when UPI-paid RD isn't covered by an ATM withdrawal", async () => {
    as("arun");
    const r = await depositToPostOffice({ ok: false }, form({ date, receiptIds: collectedIds.join(","), poReceiptNo: "7781 2290", amount: "1" }));
    expect(r.ok).toBe(false); // amount ≠ ticked total, and staff can't override
    const receipts = await prisma.receipt.findMany({ where: { id: { in: collectedIds } } });
    const total = sum(receipts.map((x) => x.amount)).toFixed(2);
    const noAtm = await depositToPostOffice({ ok: false }, form({ date, receiptIds: collectedIds.join(","), poReceiptNo: "7781 2290", amount: total }));
    expect(noAtm.error).toMatch(/UPI-paid receipts .* vs ATM withdrawn today/);
  });

  it("ATM withdrawal for the UPI part, then deposit: receipts Deposited, cash out, commission linked", async () => {
    as("arun");
    const receipts = await prisma.receipt.findMany({ where: { id: { in: collectedIds } } });
    const upi = receipts.filter((x) => x.mode !== "Cash").reduce((s, x) => s.plus(x.amount), ZERO);
    const total = sum(receipts.map((x) => x.amount));
    const before = await cashDay();

    expect(await recordAtmWithdrawal({ ok: false }, await atmForm(upi.toFixed(2)))).toEqual({ ok: true });
    expect(await depositToPostOffice({ ok: false }, form({ date, receiptIds: collectedIds.join(","), poReceiptNo: "7781 2290", amount: total.toFixed(2), denominations: cashFor(total.toFixed(2)) }))).toEqual({ ok: true });

    const after = await prisma.receipt.findMany({ where: { id: { in: collectedIds } } });
    expect(new Set(after.map((x) => x.rdStatus))).toEqual(new Set(["Deposited"]));
    const deposit = await prisma.poDeposit.findFirstOrThrow({ where: { poReceiptNo: "7781 2290", createdAt: { gte: started } }, include: { lines: true } });
    expect(deposit.lines).toHaveLength(collectedIds.length);
    expect(await prisma.commission.count({ where: { poDepositId: deposit.id } })).toBe(collectedIds.length);
    // Cash: + ATM − deposit
    const cash = await cashDay();
    expect(cash.closing.toFixed(2)).toBe(before.closing.plus(upi).minus(total).toFixed(2));
    // Already-deposited receipts can't go again
    expect((await depositToPostOffice({ ok: false }, form({ date, receiptIds: collectedIds[0], poReceiptNo: "X1", amount: "1" }))).ok).toBe(false);
  });

  it("close: refused until counted, tallied and verified; staff can't close", async () => {
    as("arun");
    await expect(closeDayBook({ ok: false }, form({ date }))).rejects.toThrow(/DayBook.Close/);
    as("admin");
    expect((await closeDayBook({ ok: false }, form({ date }))).error).toMatch(/Count the cash first/);

    const computed = (await cashDay()).closing;
    // Short by ₹100
    await saveCashCount({ ok: false }, form({ date, GRM: computed.minus(100).toFixed(2), PostOffice: "", ESevai: "", PAN: "", Others: "" }));
    expect((await closeDayBook({ ok: false }, form({ date }))).error).toMatch(/NOT TALLIED.*difference -?₹100/);

    // Count split by source, adding up exactly
    const grm = computed.minus(1300);
    expect(await saveCashCount({ ok: false }, form({ date, GRM: grm.toFixed(2), ESevai: "1000", PAN: "300", PostOffice: "", Others: "" }))).toEqual({ ok: true });
    expect((await closeDayBook({ ok: false }, form({ date }))).error).toMatch(/verification/);
    expect(await saveVerification({ ok: false }, form({ date, verifiedById: users.admin.id }))).toEqual({ ok: true });
    expect(await closeDayBook({ ok: false }, form({ date }))).toEqual({ ok: true });

    const closes = await prisma.dayClose.findMany({ where: { date: today } });
    expect(closes).toHaveLength(5);
    expect(closes.every((c) => c.status === "Closed")).toBe(true);
  });

  it("step 9: a closed day is read-only", async () => {
    as("arun");
    const atm = await recordAtmWithdrawal({ ok: false }, await atmForm("100", "late"));
    expect(atm.error).toMatch(/is closed; closed days are read-only/);
    expect((await saveCashCount({ ok: false }, form({ date, GRM: "1", PostOffice: "", ESevai: "", PAN: "", Others: "" }))).error).toMatch(/closed/);
    as("admin");
    expect((await closeDayBook({ ok: false }, form({ date }))).error).toMatch(/already closed/);
  });

  it("after close: decisions still work, money waits for an open day", async () => {
    // Step 10 happens after the close: the Owner's approval succeeds without moving money
    as("superadmin");
    const approved = await approveExpense(laptopId);
    expect(approved.ok).toBe(true);
    expect(approved.message).toMatch(/mark it paid on the next open day/);
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: laptopId } })).status).toBe("Approved");
    expect(await prisma.dayBookEntry.count({ where: { sourceId: laptopId } })).toBe(0);
    expect((await markExpensePaid(laptopId)).error).toMatch(/closed/);

    // A receipt can't be recorded into the closed day — refused, not crashed
    as("arun");
    const policy = await prisma.policy.findFirstOrThrow({ where: { policyNumber: "RD 2231-104" } });
    const r = await createReceipt({ ok: false }, form({ customerId: policy.customerId, policyId: policy.id, amount: "1000", mode: "Cash", reference: "", notes: "", slipIds: "" }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/closed/);

    // Cancelling an expense that never moved money is fine on a closed day
    as("admin");
    expect(await cancelExpense({ ok: false }, form({ expenseId: printerId, reason: "duplicate" }))).toEqual({ ok: true });
  });
});
