// "Pay to company" on the Renewals Paid tab: collected premiums paid on to the insurer, with a Day Book money-out entry.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fmtDate, isoDate, istToday } from "@/lib/dates";
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

const { payToCompany } = await import("@/app/(app)/renewals/actions");
const { depositOneRdReceipt } = await import("@/app/(app)/daybook/actions");
const { DEPOSIT_WHERE } = await import("@/lib/deposit-status");
const { cancelReceipt } = await import("@/app/(app)/receipts/actions");
const { loadRenewals } = await import("@/lib/renewals");
const started = new Date();
const today = istToday();
let admin: U;
let bankId = "";
let pending: { id: string; receiptNo: string; partner: string }[] = [];
let rdReceiptId = "";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeAll(async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  admin = { id: u.id, name: u.name, username: "admin", role: u.role, tenantId: u.tenantId };
  bankId = (await prisma.account.findFirstOrThrow({ where: { type: "Bank" } })).id;
  // Insurance premiums collected (seeded receipts), not yet paid to the insurer
  const receipts = await prisma.receipt.findMany({
    where: { status: "Saved", ownerPaid: false, rdStatus: null, companyPaymentId: null, paymentId: null, policy: { productType: "Insurance" }, renewalItems: { some: {} } },
    include: { policy: true },
    orderBy: { receiptDate: "asc" },
  });
  pending = receipts.map((r) => ({ id: r.id, receiptNo: r.receiptNo, partner: r.policy!.partner }));
  rdReceiptId = (await prisma.receipt.findFirstOrThrow({ where: { status: "Saved", rdStatus: "Collected", ownerPaid: false } })).id;
});

afterAll(async () => {
  // RD deposited from its receipt page
  const deposits = await prisma.poDeposit.findMany({ where: { createdAt: { gte: started }, poReceiptNo: "PO-TXN-9001" }, select: { id: true } });
  const depositIds = deposits.map((d) => d.id);
  await prisma.dayBookEntry.deleteMany({ where: { sourceId: { in: depositIds } } });
  await prisma.commission.updateMany({ where: { poDepositId: { in: depositIds } }, data: { poDepositId: null } });
  await prisma.poDepositLine.deleteMany({ where: { poDepositId: { in: depositIds } } });
  await prisma.poDeposit.deleteMany({ where: { id: { in: depositIds } } });
  await prisma.receipt.update({ where: { id: rdReceiptId }, data: { rdStatus: "Collected" } });
  const payments = await prisma.companyPayment.findMany({ where: { createdAt: { gte: started } }, select: { id: true } });
  const ids = payments.map((p) => p.id);
  await prisma.dayBookEntry.deleteMany({ where: { sourceId: { in: ids } } });
  await prisma.receipt.updateMany({ where: { companyPaymentId: { in: ids } }, data: { companyPaymentId: null } });
  await prisma.companyPayment.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("Pay to company", () => {
  it("lists collected premiums as pending, RD as waiting for the PO deposit", async () => {
    expect(pending.length).toBeGreaterThan(1);
    const rows = (await loadRenewals(admin as SessionUser, { tab: "paid", paidto: "pending" }, today)).rows;
    const statuses = new Map(rows.map((r) => [r.paidReceiptId, r.companyStatus]));
    expect(statuses.get(pending[0].id)).toEqual({ state: "pending", text: `Pending with ${pending[0].partner}`, payable: true });
    expect(rows.some((r) => r.companyStatus?.text === "Pending with Post Office · RD deposit" && !r.companyStatus.payable)).toBe(true);
    expect(rows.every((r) => r.companyStatus?.state === "pending")).toBe(true);
  });

  it("refuses mixed companies, RD receipts, future dates and a missing reference", async () => {
    session.user = admin;
    const base = { paidOn: isoDate(today), accountId: bankId, reference: "LIC-REF-1" };
    const other = pending.find((p) => p.partner !== pending[0].partner);
    if (other) {
      const r = await payToCompany({ ok: false }, form({ ...base, receiptIds: `${pending[0].id},${other.id}` }));
      expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/one company at a time/) });
    }
    expect(await payToCompany({ ok: false }, form({ ...base, receiptIds: rdReceiptId }))).toMatchObject({ ok: false, error: expect.stringMatching(/no longer waiting/) });
    const tomorrow = new Date(today.getTime() + 86_400_000);
    expect(await payToCompany({ ok: false }, form({ ...base, paidOn: isoDate(tomorrow), receiptIds: pending[0].id }))).toMatchObject({ ok: false, error: expect.stringMatching(/future/) });
    expect(await payToCompany({ ok: false }, form({ ...base, reference: "", receiptIds: pending[0].id }))).toMatchObject({ ok: false, error: expect.stringMatching(/receipt \/ UTR/) });
  });

  it("pays one company: receipts marked paid with date + reference, money leaves the bank in the Day Book", async () => {
    session.user = admin;
    const company = pending[0].partner;
    const same = pending.filter((p) => p.partner === company);
    const r = await payToCompany({ ok: false }, form({ receiptIds: same.map((p) => p.id).join(","), paidOn: isoDate(today), accountId: bankId, reference: "INS-778812" }));
    expect(r).toEqual({ ok: true });

    const payment = await prisma.companyPayment.findFirstOrThrow({ where: { reference: "INS-778812" }, include: { receipts: true } });
    expect(payment.company).toBe(company);
    expect(payment.receipts.map((x) => x.id).sort()).toEqual(same.map((p) => p.id).sort());
    const entry = await prisma.dayBookEntry.findFirstOrThrow({ where: { sourceId: payment.id } });
    expect([entry.direction, entry.entryType, entry.accountId, entry.amount.toFixed(2)]).toEqual(["Out", "PaidToCompany", bankId, payment.amount.toFixed(2)]);

    const paidRows = (await loadRenewals(admin as SessionUser, { tab: "paid", paidto: "paid" }, today)).rows;
    const row = paidRows.find((x) => x.paidReceiptId === same[0].id)!;
    expect(row.companyStatus).toMatchObject({ state: "paid", payable: false, text: `Paid to ${company} · ${fmtDate(today)} · ref INS-778812 · by ${admin.name}` });
    const { createdById } = await prisma.receipt.findUniqueOrThrow({ where: { id: same[0].id } });
    expect(row.collectedBy).toBe((await prisma.user.findUniqueOrThrow({ where: { id: createdById } })).name);
    const pendingRows = (await loadRenewals(admin as SessionUser, { tab: "paid", paidto: "pending" }, today)).rows;
    expect(pendingRows.some((x) => x.paidReceiptId === same[0].id)).toBe(false);

    // Paying the same receipts again, or cancelling one, is refused
    expect(await payToCompany({ ok: false }, form({ receiptIds: same[0].id, paidOn: isoDate(today), accountId: bankId, reference: "AGAIN" }))).toMatchObject({ ok: false });
    expect(await cancelReceipt({ ok: false }, form({ receiptId: same[0].id, reason: "mistake" }))).toMatchObject({ ok: false, error: expect.stringMatching(/paid to the company/) });
  });
});

describe("Deposit status from the receipt page", () => {
  it("an RD receipt is deposited on its own with the PO transaction ID: one-line PO deposit, Day Book out, can't cancel", async () => {
    session.user = admin;
    const rd = await prisma.receipt.findUniqueOrThrow({ where: { id: rdReceiptId } });
    const pendingBefore = await prisma.receipt.count({ where: { id: rdReceiptId, ...DEPOSIT_WHERE.pending } });
    expect(pendingBefore).toBe(1);
    const r = await depositOneRdReceipt({ ok: false }, form({ receiptId: rdReceiptId, paidOn: isoDate(today), accountId: bankId, reference: "PO-TXN-9001" }));
    expect(r).toEqual({ ok: true });

    const after = await prisma.receipt.findUniqueOrThrow({ where: { id: rdReceiptId }, include: { poDepositLine: { include: { poDeposit: true } } } });
    expect(after.rdStatus).toBe("Deposited");
    expect([after.poDepositLine?.poDeposit.poReceiptNo, after.poDepositLine?.poDeposit.amount.toFixed(2)]).toEqual(["PO-TXN-9001", rd.amount.toFixed(2)]);
    const entry = await prisma.dayBookEntry.findFirstOrThrow({ where: { sourceId: after.poDepositLine!.poDepositId } });
    expect([entry.direction, entry.entryType, entry.accountId, entry.mode]).toEqual(["Out", "DepositToPo", bankId, "Bank"]);
    expect(await prisma.receipt.count({ where: { id: rdReceiptId, ...DEPOSIT_WHERE.paid } })).toBe(1);

    expect(await depositOneRdReceipt({ ok: false }, form({ receiptId: rdReceiptId, paidOn: isoDate(today), accountId: bankId, reference: "AGAIN" }))).toMatchObject({ ok: false, error: expect.stringMatching(/no longer waiting/) });
    expect(await cancelReceipt({ ok: false }, form({ receiptId: rdReceiptId, reason: "mistake" }))).toMatchObject({ ok: false, error: expect.stringMatching(/post office/) });
  });

  it("an insurance receipt can be marked on its own; a missing transaction ID is refused", async () => {
    session.user = admin;
    const one = pending.find((p) => p.partner !== pending[0].partner); // pending[0]'s company was paid above
    if (!one) return;
    expect(await depositOneRdReceipt({ ok: false }, form({ receiptId: one.id, paidOn: isoDate(today), accountId: bankId, reference: "X1" }))).toMatchObject({ ok: false });
    expect(await payToCompany({ ok: false }, form({ receiptIds: one.id, paidOn: isoDate(today), accountId: bankId, reference: "" }))).toMatchObject({ ok: false });
    expect(await payToCompany({ ok: false }, form({ receiptIds: one.id, paidOn: isoDate(today), accountId: bankId, reference: "UTR-55120" }))).toEqual({ ok: true });
    expect(await prisma.receipt.count({ where: { id: one.id, ...DEPOSIT_WHERE.paid } })).toBe(1);
  });
});
