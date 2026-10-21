// Phase 6 / change set 0: cash denomination, net banking, owner-paid for all billed products, direct bills,
// post office verification, BL- bill numbers. Runs against the seeded database; rows it creates are removed afterwards.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { accountDay } from "@/lib/daybook";
import { istToday } from "@/lib/dates";
import { prisma } from "@/lib/db";

const session = vi.hoisted(() => ({ user: null as null | { id: string; name: string; username: string; role: "Admin" | "User" | "SuperAdmin"; tenantId: string } }));
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

const { createReceipt, recordOwnerPaid } = await import("@/app/(app)/receipts/actions");
const { createDirectBill, cancelDirectBill } = await import("@/app/(app)/direct-bills/actions");
const { setVerification } = await import("@/app/(app)/receipts/verification/actions");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const base = { policyId: "", reference: "", bankName: "", notes: "", slipIds: "", denominations: "" };
const users: Record<string, { id: string; name: string; username: string; role: "Admin" | "User" | "SuperAdmin"; tenantId: string }> = {};
const as = (u: keyof typeof users) => { session.user = users[u]; };

const receipts: string[] = [];
const bills: string[] = [];
const slips: string[] = [];
const items: string[] = [];
const companyPayments: string[] = [];
const verifiedDeposits: string[] = [];

beforeAll(async () => {
  for (const [key, username] of [["admin", "admin"], ["user", "arun"], ["owner", "superadmin"]]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    users[key] = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
  }
  as("admin");
});

afterAll(async () => {
  const sources = [...receipts, ...bills];
  await prisma.dayBookEntry.deleteMany({ where: { sourceId: { in: sources }, reversalOfId: { not: null } } });
  await prisma.dayBookEntry.deleteMany({ where: { sourceId: { in: sources } } });
  await prisma.messageLog.deleteMany({ where: { relatedId: { in: [...sources, ...slips] } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...bills, ...companyPayments, ...verifiedDeposits] } } });
  await prisma.renewalItem.updateMany({ where: { id: { in: items } }, data: { status: "Due", paidOn: null, paidReceiptId: null } });
  await prisma.ownerPaidSlip.deleteMany({ where: { id: { in: slips } } });
  await prisma.receipt.deleteMany({ where: { id: { in: receipts } } });
  await prisma.directBill.deleteMany({ where: { id: { in: bills } } });
  await prisma.companyPayment.deleteMany({ where: { id: { in: companyPayments } } });
  await prisma.$disconnect();
});

describe("Cash denomination and net banking", () => {
  it("cash is refused unless notes and coins add up; the denomination is stored", async () => {
    const policy = await prisma.policy.findFirstOrThrow({ where: { policyNumber: "RD 2231-105" } });
    const short = await createReceipt({ ok: false }, form({ ...base, customerId: policy.customerId, policyId: policy.id, amount: "700", mode: "Cash", denominations: JSON.stringify({ "500": 1, "100": 1 }) }));
    expect(short).toMatchObject({ ok: false, fieldErrors: { denominations: expect.stringMatching(/adds up to ₹600/) } });
    const missing = await createReceipt({ ok: false }, form({ ...base, customerId: policy.customerId, policyId: policy.id, amount: "700", mode: "Cash" }));
    expect(missing.fieldErrors).toHaveProperty("denominations");

    const r = await createReceipt({ ok: false }, form({ ...base, customerId: policy.customerId, policyId: policy.id, amount: "700", mode: "Cash", denominations: JSON.stringify({ "500": 1, "100": 1, "50": 1, coins: "50" }) }));
    expect(r.ok).toBe(true);
    receipts.push(r.id!);
    const saved = await prisma.receipt.findUniqueOrThrow({ where: { id: r.id } });
    expect(saved.denominations).toEqual({ "500": 1, "100": 1, "50": 1, coins: "50" });
  });

  it("net banking needs the customer's bank (from the list) and a transaction ID; both show in the Day Book row", async () => {
    const policy = await prisma.policy.findFirstOrThrow({ where: { policyNumber: "RD 2231-105" } });
    const common = { ...base, customerId: policy.customerId, policyId: policy.id, amount: "300", mode: "NetBanking" };
    expect((await createReceipt({ ok: false }, form({ ...common, reference: "TXN1" }))).fieldErrors).toHaveProperty("bankName");
    expect((await createReceipt({ ok: false }, form({ ...common, reference: "TXN1", bankName: "Not a bank" }))).fieldErrors).toHaveProperty("bankName");
    expect((await createReceipt({ ok: false }, form({ ...common, bankName: "HDFC" }))).fieldErrors).toHaveProperty("reference");

    const r = await createReceipt({ ok: false }, form({ ...common, reference: "NEFT55120931", bankName: "HDFC" }));
    expect(r.ok).toBe(true);
    receipts.push(r.id!);
    const saved = await prisma.receipt.findUniqueOrThrow({ where: { id: r.id } });
    expect(saved).toMatchObject({ mode: "NetBanking", bankName: "HDFC", reference: "NEFT55120931", denominations: null });
    const entry = await prisma.dayBookEntry.findFirstOrThrow({ where: { sourceId: r.id } });
    expect(entry.particulars).toContain("Net banking · HDFC · NEFT55120931");
  });

  it("a mode switched off in Settings is refused", async () => {
    const opt = await prisma.paymentOption.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, kind: "Mode", name: "Card" } });
    await prisma.paymentOption.update({ where: { id: opt.id }, data: { active: false } });
    try {
      const policy = await prisma.policy.findFirstOrThrow({ where: { policyNumber: "RD 2231-105" } });
      const r = await createReceipt({ ok: false }, form({ ...base, customerId: policy.customerId, policyId: policy.id, amount: "300", mode: "Card", reference: "APP1" }));
      expect(r.error).toMatch(/switched off/);
    } finally {
      await prisma.paymentOption.update({ where: { id: opt.id }, data: { active: true } });
    }
  });
});

describe("Owner-paid for every billed product", () => {
  it("an insurance bill can be owner-paid with the insurer's reference; no RD commission is recorded", async () => {
    const item = await prisma.renewalItem.findFirstOrThrow({
      where: { tenantId: users.admin.tenantId, status: { in: ["Due", "Overdue"] }, policy: { productType: "Insurance", status: "Active" } },
      orderBy: { dueDate: "asc" },
    });
    items.push(item.id);
    const before = await prisma.commission.count();
    const r = await recordOwnerPaid({ ok: false }, form({ renewalItemId: item.id, poReceiptNo: "LIC-RCPT-7781" }));
    expect(r.ok).toBe(true);
    slips.push(r.id!);
    expect(await prisma.renewalItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: "Paid" });
    expect(await prisma.ownerPaidSlip.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ poReceiptNo: "LIC-RCPT-7781", status: "CustomerOwes" });
    expect(await prisma.commission.count()).toBe(before);
  });

  it("mutual funds can't be owner-paid", async () => {
    const item = await prisma.renewalItem.findFirst({ where: { status: { in: ["Due", "Overdue"] }, policy: { productType: "MutualFund" } } });
    if (!item) return; // seed without SIP dues
    expect((await recordOwnerPaid({ ok: false }, form({ renewalItemId: item.id, poReceiptNo: "X-123" }))).error).toMatch(/not open/);
  });
});

describe("Direct bills", () => {
  const bill = { payerName: "", payerMobile: "", purpose: "Form filling charges", amount: "150", billDate: "", reference: "", bankName: "", mode: "Cash", denominations: JSON.stringify({ "100": 1, "50": 1 }) };

  it("a walk-in bill gets a DB- number, posts money in and is not linked to anyone", async () => {
    as("user");
    const cashIn = async () => (await accountDay(prisma, users.admin.tenantId, istToday())).find((a) => a.type === "Cash")!.totalIn;
    const before = await cashIn();
    const r = await createDirectBill({ ok: false }, form({ ...bill, payerName: "Walk-in Ganesh", payerMobile: "6000011122" }));
    expect(r.ok).toBe(true);
    expect((await cashIn()).minus(before).toFixed(2)).toBe("150.00"); // today's Day Book cash in includes it
    bills.push(r.id!);
    const b = await prisma.directBill.findUniqueOrThrow({ where: { id: r.id } });
    expect(b.billNo).toMatch(/^DB-\d{4}$/);
    expect(b.customerId).toBeNull();
    const entries = await prisma.dayBookEntry.findMany({ where: { sourceType: "DirectBill", sourceId: b.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ direction: "In", entryType: "Collection", productCategory: "Direct bill" });
    expect(entries[0].amount.toFixed(2)).toBe("150.00");
    as("admin");
  });

  it("a bill from a customer's mobile is linked to that customer", async () => {
    const c = await prisma.customer.findFirstOrThrow({ where: { tenantId: users.admin.tenantId }, orderBy: { createdAt: "asc" } });
    const r = await createDirectBill({ ok: false }, form({ ...bill, payerName: c.name, payerMobile: c.mobile }));
    expect(r.ok).toBe(true);
    bills.push(r.id!);
    expect((await prisma.directBill.findUniqueOrThrow({ where: { id: r.id } })).customerId).toBe(c.id);
  });

  it("checks mobile, purpose and cash; staff can't cancel; Admin cancel keeps the number and reverses the Day Book", async () => {
    expect((await createDirectBill({ ok: false }, form({ ...bill, payerName: "A B", payerMobile: "12345" }))).fieldErrors).toHaveProperty("payerMobile");
    expect((await createDirectBill({ ok: false }, form({ ...bill, payerName: "A B", payerMobile: "6000011122", purpose: "" }))).fieldErrors).toHaveProperty("purpose");
    expect((await createDirectBill({ ok: false }, form({ ...bill, payerName: "A B", payerMobile: "6000011122", amount: "200" }))).fieldErrors).toHaveProperty("denominations");

    const r = await createDirectBill({ ok: false }, form({ ...bill, payerName: "A B", payerMobile: "6000011122" }));
    bills.push(r.id!);
    as("user");
    await expect(cancelDirectBill({ ok: false }, form({ billId: r.id!, reason: "Duplicate" }))).rejects.toThrow(/Not allowed/);
    as("admin");
    expect((await cancelDirectBill({ ok: false }, form({ billId: r.id!, reason: "" }))).ok).toBe(false);
    expect(await cancelDirectBill({ ok: false }, form({ billId: r.id!, reason: "Entered twice" }))).toMatchObject({ ok: true });
    const b = await prisma.directBill.findUniqueOrThrow({ where: { id: r.id } });
    expect(b).toMatchObject({ status: "Cancelled", cancelReason: "Entered twice", cancelledById: users.admin.id });
    const entries = await prisma.dayBookEntry.findMany({ where: { sourceId: b.id } });
    expect(entries.map((e) => e.direction).sort()).toEqual(["In", "Out"]);
    expect((await cancelDirectBill({ ok: false }, form({ billId: r.id!, reason: "again" }))).error).toMatch(/Already/);
  });
});

describe("Post office verification", () => {
  it("RD deposit: Mismatch needs a note and can be re-checked; Verified moves its receipts to Verified and is final", async () => {
    const dep = await prisma.poDeposit.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, verifyStatus: "Pending", lines: { some: {} } }, include: { lines: true } });
    verifiedDeposits.push(dep.id);
    const receiptIds = dep.lines.map((l) => l.receiptId);
    try {
      expect((await setVerification({ ok: false }, form({ kind: "PoDeposit", id: dep.id, status: "Mismatch", note: "" }))).fieldErrors).toHaveProperty("note");
      expect((await setVerification({ ok: false }, form({ kind: "PoDeposit", id: dep.id, status: "Mismatch", note: "Portal shows ₹100 less" }))).ok).toBe(true);
      expect(await prisma.poDeposit.findUniqueOrThrow({ where: { id: dep.id } })).toMatchObject({ verifyStatus: "Mismatch", verifyNote: "Portal shows ₹100 less" });

      as("user"); // every role can record the check
      expect((await setVerification({ ok: false }, form({ kind: "PoDeposit", id: dep.id, status: "Verified" }))).ok).toBe(true);
      as("admin");
      expect(await prisma.poDeposit.findUniqueOrThrow({ where: { id: dep.id } })).toMatchObject({ verifyStatus: "Verified", verifiedById: users.user.id });
      const rs = await prisma.receipt.findMany({ where: { id: { in: receiptIds } } });
      expect(rs.every((r) => r.rdStatus === "Verified")).toBe(true);
      expect((await setVerification({ ok: false }, form({ kind: "PoDeposit", id: dep.id, status: "Mismatch", note: "late" }))).error).toMatch(/Already verified/);
    } finally {
      as("admin");
      await prisma.poDeposit.update({ where: { id: dep.id }, data: { verifyStatus: "Pending", verifyNote: null, verifiedById: null, verifiedAt: null } });
      await prisma.receipt.updateMany({ where: { id: { in: receiptIds } }, data: { rdStatus: "Deposited" } });
    }
  });

  it("only post office company payments are verified (not insurers)", async () => {
    const account = await prisma.account.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, type: "Bank" } });
    const common = { tenantId: users.admin.tenantId, paidOn: new Date(), accountId: account.id, mode: "Bank" as const, amount: "1000", createdById: users.admin.id };
    const po = await prisma.companyPayment.create({ data: { ...common, company: "Post Office", reference: "PPF-CHK-1" } });
    const lic = await prisma.companyPayment.create({ data: { ...common, company: "LIC", reference: "LIC-CHK-1" } });
    companyPayments.push(po.id, lic.id);
    expect((await setVerification({ ok: false }, form({ kind: "CompanyPayment", id: lic.id, status: "Verified" }))).error).toMatch(/Not found/);
    expect((await setVerification({ ok: false }, form({ kind: "CompanyPayment", id: po.id, status: "Verified" }))).ok).toBe(true);
    expect((await prisma.companyPayment.findUniqueOrThrow({ where: { id: po.id } })).verifyStatus).toBe("Verified");
  });
});

describe("BL- bill numbers", () => {
  it("every due has a unique BL- number", async () => {
    const all = await prisma.renewalItem.findMany({ where: { tenantId: users.admin.tenantId }, select: { billNo: true } });
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((i) => /^BL-\d{4,}$/.test(i.billNo))).toBe(true);
    expect(new Set(all.map((i) => i.billNo)).size).toBe(all.length);
  });
});
