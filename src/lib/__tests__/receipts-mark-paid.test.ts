// Receipts → Customer receipts: tick receipts of any customers / companies and "Mark paid" (4 Nov 2026).
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

const { markReceiptsPaid } = await import("@/app/(app)/receipts/mark-paid-actions");
const started = new Date();
const today = isoDate(istToday());
const REF = `MP-${started.getTime() % 100000}`;
let admin: U;
let bankId = "", cashId = "";
let insurance: { id: string; partner: string; amount: string }[] = [];
let rdIds: string[] = [];

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeAll(async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  admin = { id: u.id, name: u.name, username: "admin", role: u.role, tenantId: u.tenantId };
  session.user = admin;
  bankId = (await prisma.account.findFirstOrThrow({ where: { type: "Bank", isDefault: true } })).id;
  cashId = (await prisma.account.findFirstOrThrow({ where: { type: "Cash" } })).id;
  const waiting = await prisma.receipt.findMany({
    where: { status: "Saved", ownerPaid: false, rdStatus: null, companyPaymentId: null, policy: { productType: "Insurance" } },
    include: { policy: true }, orderBy: { receiptDate: "asc" },
  });
  // two companies' receipts
  const companies = [...new Set(waiting.map((r) => r.policy!.partner))].slice(0, 2);
  insurance = companies.map((c) => waiting.find((r) => r.policy!.partner === c)!).map((r) => ({ id: r.id, partner: r.policy!.partner, amount: r.amount.toString() }));
  rdIds = (await prisma.receipt.findMany({ where: { status: "Saved", rdStatus: "Collected", ownerPaid: false }, take: 2, select: { id: true } })).map((r) => r.id);
});

afterAll(async () => {
  const payments = (await prisma.companyPayment.findMany({ where: { createdAt: { gte: started } }, select: { id: true } })).map((p) => p.id);
  const deposits = (await prisma.poDeposit.findMany({ where: { createdAt: { gte: started } }, select: { id: true } })).map((d) => d.id);
  await prisma.dayBookEntry.deleteMany({ where: { sourceId: { in: [...payments, ...deposits] } } });
  await prisma.receipt.updateMany({ where: { companyPaymentId: { in: payments } }, data: { companyPaymentId: null } });
  await prisma.companyPayment.deleteMany({ where: { id: { in: payments } } });
  await prisma.commission.updateMany({ where: { poDepositId: { in: deposits } }, data: { poDepositId: null } });
  await prisma.poDepositLine.deleteMany({ where: { poDepositId: { in: deposits } } });
  await prisma.poDeposit.deleteMany({ where: { id: { in: deposits } } });
  await prisma.receipt.updateMany({ where: { id: { in: rdIds } }, data: { rdStatus: "Collected" } });
  await prisma.$disconnect();
});

describe("Mark paid from Receipts", () => {
  it("refuses a future date, a missing reference and cash without the note count", async () => {
    expect(insurance.length).toBe(2);
    const ids = insurance.map((r) => r.id).join(",");
    const tomorrow = isoDate(new Date(istToday().getTime() + 86_400_000));
    expect((await markReceiptsPaid({ ok: false }, form({ receiptIds: ids, paidOn: tomorrow, accountId: bankId, reference: REF }))).error).toMatch(/future/);
    expect((await markReceiptsPaid({ ok: false }, form({ receiptIds: ids, paidOn: today, accountId: bankId, reference: "" }))).error).toMatch(/UTR/);
    expect((await markReceiptsPaid({ ok: false }, form({ receiptIds: ids, paidOn: today, accountId: cashId, reference: REF }))).error).toMatch(/denomination/);
  });

  it("two companies + RD in one go: a company payment each, one PO deposit, Day Book lines", async () => {
    const ids = [...insurance.map((r) => r.id), ...rdIds];
    const r = await markReceiptsPaid({ ok: false }, form({ receiptIds: ids.join(","), paidOn: today, accountId: bankId, reference: REF }));
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(new RegExp(`^${ids.length} receipts marked paid: `));
    const payments = await prisma.companyPayment.findMany({ where: { reference: REF }, include: { receipts: true } });
    expect(payments.map((p) => p.company).sort()).toEqual(insurance.map((x) => x.partner).sort());
    expect(payments.every((p) => p.receipts.length === 1 && p.accountId === bankId)).toBe(true);
    const deposit = await prisma.poDeposit.findFirstOrThrow({ where: { poReceiptNo: REF }, include: { lines: true } });
    expect(deposit.lines.map((l) => l.receiptId).sort()).toEqual([...rdIds].sort());
    expect((await prisma.receipt.findMany({ where: { id: { in: rdIds } } })).every((x) => x.rdStatus === "Deposited")).toBe(true);
    expect(await prisma.dayBookEntry.count({ where: { sourceId: { in: [...payments.map((p) => p.id), deposit.id] } } })).toBe(3);
    // already paid: refused
    expect((await markReceiptsPaid({ ok: false }, form({ receiptIds: insurance[0].id, paidOn: today, accountId: bankId, reference: REF }))).error).toMatch(/no longer waiting/);
  });
});
