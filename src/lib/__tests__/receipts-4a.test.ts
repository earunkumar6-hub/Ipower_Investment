// Change set phase 4a – receipts: "Received into" bank account, the customer's receipt number on paid bills,
// and the Receipts filters. Runs against the seeded database; every row it creates is removed afterwards.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setAccessOverrides } from "@/lib/permissions";
import { loadCustomer360 } from "@/lib/customer-360";
import { istToday } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { receiptFilter } from "@/lib/lists";
import { loadRenewals } from "@/lib/renewals";

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

const { createReceipt } = await import("@/app/(app)/receipts/actions");
const { createDirectBill } = await import("@/app/(app)/direct-bills/actions");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const base = { policyId: "", reference: "", bankName: "", netType: "", notes: "", slipIds: "", denominations: "", intoAccountId: "" };
const users: Record<string, U> = {};
const as = (u: string) => (session.user = users[u]);
const receipts: string[] = [];
const payments: string[] = [];
const bills: string[] = [];
const accounts: string[] = [];
let second = "", off = "", defaultBank = "";
let rd: Awaited<ReturnType<typeof loadPolicy>>;
const loadPolicy = (policyNumber: string) => prisma.policy.findFirstOrThrow({ where: { policyNumber }, include: { renewals: true } });

beforeAll(async () => {
  for (const username of ["arun", "admin"]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    users[username] = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
  }
  const tenantId = users.admin.tenantId;
  defaultBank = (await prisma.account.findFirstOrThrow({ where: { tenantId, type: "Bank", isDefault: true } })).id;
  const mk = (name: string, last4: string, active: boolean) => prisma.account.create({
    data: { tenantId, type: "Bank", name, bankName: "Vitest Bank", last4, openingBalance: 0, openingDate: istToday(), active },
  });
  second = (await mk("Vitest second", "4321", true)).id;
  off = (await mk("Vitest off", "8765", false)).id;
  accounts.push(second, off);
  rd = await loadPolicy("RD 3112-284");
});

afterAll(async () => {
  const lines = await prisma.receipt.findMany({ where: { OR: [{ id: { in: receipts } }, { paymentId: { in: payments } }] }, select: { id: true } });
  const ids = [...lines.map((r) => r.id), ...bills];
  await prisma.dayBookEntry.deleteMany({ where: { sourceId: { in: ids } } });
  await prisma.commission.deleteMany({ where: { receiptId: { in: ids } } });
  await prisma.messageLog.deleteMany({ where: { relatedId: { in: [...ids, ...payments] } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: bills } } });
  for (const r of rd.renewals) await prisma.renewalItem.update({ where: { id: r.id }, data: { status: r.status, paidOn: r.paidOn, paidReceiptId: r.paidReceiptId } });
  await prisma.receipt.deleteMany({ where: { id: { in: lines.map((r) => r.id) } } });
  await prisma.payment.deleteMany({ where: { id: { in: payments } } });
  await prisma.directBill.deleteMany({ where: { id: { in: bills } } });
  await prisma.account.deleteMany({ where: { id: { in: accounts } } });
  await prisma.$disconnect();
});

describe("Received into (#3)", () => {
  const upi = (intoAccountId: string) => form({ ...base, customerId: rd.customerId, policyId: rd.id, amount: "250", mode: "UPI", reference: "UTR-VT-1", intoAccountId });

  it("non-cash receipts need an active bank account", async () => {
    as("admin");
    expect((await createReceipt({ ok: false }, upi(""))).fieldErrors).toHaveProperty("intoAccountId");
    expect((await createReceipt({ ok: false }, upi(off))).error).toMatch(/switched off/);
    const cash = await prisma.account.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, type: "Cash" } });
    expect((await createReceipt({ ok: false }, upi(cash.id))).fieldErrors).toHaveProperty("intoAccountId");
  });

  it("the receipt and its Day Book line go to the account picked", async () => {
    as("admin");
    const r = await createReceipt({ ok: false }, upi(second));
    expect(r.ok).toBe(true);
    receipts.push(r.id!);
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: r.id } })).accountId).toBe(second);
    expect((await prisma.dayBookEntry.findFirstOrThrow({ where: { sourceId: r.id } })).accountId).toBe(second);
  });

  it("cash always goes to the cash drawer", async () => {
    as("admin");
    const r = await createReceipt({ ok: false }, form({ ...base, customerId: rd.customerId, policyId: rd.id, amount: "500", mode: "Cash", denominations: JSON.stringify({ "500": 1 }), intoAccountId: second }));
    expect(r.ok).toBe(true);
    receipts.push(r.id!);
    const saved = await prisma.receipt.findUniqueOrThrow({ where: { id: r.id }, include: { customer: true } });
    expect((await prisma.account.findUniqueOrThrow({ where: { id: saved.accountId } })).type).toBe("Cash");
  });

  it("direct bills use the same picker", async () => {
    as("admin");
    const bill = { payerName: "Vitest Walk-in", payerMobile: "6000044455", purpose: "Photo copies", amount: "120", billDate: "", mode: "UPI", reference: "UTR-VT-2", bankName: "", netType: "", denominations: "" };
    expect((await createDirectBill({ ok: false }, form({ ...bill, intoAccountId: "" }))).fieldErrors).toHaveProperty("intoAccountId");
    const r = await createDirectBill({ ok: false }, form({ ...bill, intoAccountId: second }));
    expect(r.ok).toBe(true);
    bills.push(r.id!);
    expect((await prisma.directBill.findUniqueOrThrow({ where: { id: r.id } })).accountId).toBe(second);
  });
});

describe("Several dues, one receipt (#4)", () => {
  it("every bill paid together shows the PAY- receipt number on the customer page and in Renewals", async () => {
    as("admin");
    const open = rd.renewals.filter((r) => r.status === "Due" || r.status === "Overdue");
    const amount = open.slice(0, 2).reduce((t, r) => t + Number(r.premiumAmount), 0).toFixed(2);
    const r = await createReceipt({ ok: false }, form({ ...base, customerId: rd.customerId, dues: JSON.stringify([{ policyId: rd.id, count: 2 }]), amount, mode: "UPI", reference: "UTR-VT-3", intoAccountId: defaultBank }));
    expect(r).toMatchObject({ ok: true, href: expect.stringMatching(/^\/payments\//) });
    payments.push(r.id!);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: r.id }, include: { receipts: true } });
    expect(payment.receipts).toHaveLength(2);

    const view = await loadCustomer360(users.admin, rd.customerId);
    for (const line of payment.receipts) expect(view!.receiptNo.get(line.id)).toEqual({ no: payment.paymentNo, href: `/payments/${payment.id}` });

    const paid = await loadRenewals(users.admin, { tab: "paid", product: "po" }, istToday());
    const rows = paid.rows.filter((x) => payment.receipts.some((l) => l.id === x.paidReceiptId));
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.paidReceiptNo === payment.paymentNo && x.paidReceiptHref === `/payments/${payment.id}`)).toBe(true);
  });
});

describe("Receipts filters (#22)", () => {
  const find = async (u: U, sp: Record<string, string>) => {
    const f = receiptFilter(u, sp);
    return prisma.receipt.findMany({ where: f.receiptWhere, include: { customer: true, policy: true } });
  };

  it("each filter narrows the list, and they combine", async () => {
    const admin = users.admin;
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: rd.customerId } });

    const byName = await find(admin, { q: c.name.slice(0, 5) });
    expect(byName.length).toBeGreaterThan(0);
    expect(byName.every((r) => r.customer.name.toLowerCase().includes(c.name.slice(0, 5).toLowerCase()) || r.customer.mobile.includes(c.name.slice(0, 5)))).toBe(true);
    expect((await find(admin, { q: c.mobile })).every((r) => r.customerId === c.id || r.customer.mobile === c.mobile)).toBe(true);
    expect((await find(admin, { cif: c.cifNo })).every((r) => r.customer.cifNo === c.cifNo)).toBe(true);
    expect((await find(admin, { policy: rd.policyNumber })).every((r) => r.policy?.policyNumber === rd.policyNumber)).toBe(true);
    expect((await find(admin, { product: "insurance" })).every((r) => r.policy?.productType === "Insurance")).toBe(true);
    expect((await find(admin, { mode: "UPI" })).every((r) => r.mode === "UPI")).toBe(true);

    const intoSecond = await find(admin, { account: second });
    expect(intoSecond.map((r) => r.id)).toEqual([receipts[0]]);
    expect(await find(admin, { account: second, mode: "Cash" })).toHaveLength(0);
    expect((await find(admin, { status: "Cancelled" })).every((r) => r.status === "Cancelled")).toBe(true);

    const today = istToday().toISOString().slice(0, 10);
    const todays = await find(admin, { from: today, to: today, cif: c.cifNo });
    expect(todays.length).toBeGreaterThanOrEqual(4); // the UPI, cash and the two PAY- lines above
    expect(todays.every((r) => r.receiptDate.toISOString().slice(0, 10) === today)).toBe(true);
  });

  it("post office scheme and RD status (4 Nov 2026)", async () => {
    const admin = users.admin;
    const rdOnly = await find(admin, { scheme: "PoRd" });
    expect(rdOnly.length).toBeGreaterThan(0);
    expect(rdOnly.every((r) => r.policy?.productType === "PoRd")).toBe(true);
    expect((await find(admin, { scheme: "PoSsa" })).every((r) => r.policy?.productType === "PoSsa")).toBe(true);
    // a scheme narrows past "Product"; an unknown one is ignored
    expect((await find(admin, { product: "po", scheme: "PoRd" })).map((r) => r.id).sort()).toEqual(rdOnly.map((r) => r.id).sort());
    expect((await find(admin, { scheme: "Nonsense" })).length).toBe((await find(admin, {})).length);
    const collected = await find(admin, { rd: "Collected" });
    expect(collected.length).toBeGreaterThan(0);
    expect(collected.every((r) => r.rdStatus === "Collected")).toBe(true);
    expect((await find(admin, { rd: "Deposited", scheme: "PoRd" })).every((r) => r.rdStatus === "Deposited" && r.policy?.productType === "PoRd")).toBe(true);
    expect(receiptFilter(admin, { rd: "Collected" }).active).toBe(true);
  });

  it("with 'work on every customer' switched off a User only sees receipts they entered, whatever the filters (#10)", async () => {
    setAccessOverrides({ User: { "Records.SeeAll": false } });
    try {
      const mine = await find(users.arun, {});
      expect(mine.every((r) => r.createdById === users.arun.id)).toBe(true);
      expect(await find(users.arun, { account: second })).toHaveLength(0);
    } finally {
      setAccessOverrides({});
    }
  });

  it("owner-paid slips take the customer / product / policy filters", async () => {
    const slip = await prisma.ownerPaidSlip.findFirstOrThrow({ include: { customer: true, policy: true } });
    const f = receiptFilter(users.admin, { cif: slip.customer.cifNo, policy: slip.policy.policyNumber });
    const slips = await prisma.ownerPaidSlip.findMany({ where: f.slipWhere, include: { customer: true, policy: true } });
    expect(slips.map((s) => s.id)).toContain(slip.id);
    expect(slips.every((s) => s.customer.cifNo === slip.customer.cifNo && s.policy.policyNumber === slip.policy.policyNumber)).toBe(true);
    expect(f.params).toMatchObject({ cif: slip.customer.cifNo, policy: slip.policy.policyNumber });
  });
});
