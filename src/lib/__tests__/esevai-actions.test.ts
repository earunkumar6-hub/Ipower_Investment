// E-Sevai entries and wallets (change set #6, #7) against the seeded database. Every row they create is removed afterwards.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { istNowHHMM, istToday } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { monthKey, monthRange, profitAndLoss } from "@/lib/pnl";

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

const { createServiceEntry, rechargeWallet, findCustomerByMobile } = await import("@/app/(app)/esevai/actions");
const { saveServiceRate, deleteServiceRate } = await import("@/app/(app)/settings/esevai-rates/actions");
const { ratesInForce } = await import("@/lib/esevai");

const started = new Date();
const users: Record<string, U> = {};
const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const notes = (amount: number) => JSON.stringify({ "500": Math.floor(amount / 500), coins: (amount % 500).toFixed(2) });
const acc: Record<string, string> = {};
/** An entry form: EB ₹850 from the EB wallet, ₹860 collected in cash with notes that add up. */
const entry = (o: Record<string, string> = {}) => {
  const v = {
    serviceCode: "EB", serviceName: "", providerRef: "TNEB-TEST", customerMobile: "", customerName: "", gender: "",
    paidAmount: "850", paidVia: "Wallet", paidFromAccountId: acc.eb, providerTxnNo: "VT6-1", collected: "860",
    mode: "Cash", intoAccountId: "", ...o,
  };
  return form({ denominations: v.mode === "Cash" ? notes(Number(v.collected)) : "", ...v, ...o });
};

beforeAll(async () => {
  for (const username of ["arun", "admin"]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    users[username] = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
  }
  const t = users.admin.tenantId;
  acc.eb = (await prisma.account.findFirstOrThrow({ where: { tenantId: t, name: "EB wallet" } })).id;
  acc.cert = (await prisma.account.findFirstOrThrow({ where: { tenantId: t, name: "Certificate wallet" } })).id;
  acc.bank = (await prisma.account.findFirstOrThrow({ where: { tenantId: t, type: "Bank", isDefault: true } })).id;
  session.user = users.arun;
});

afterAll(async () => {
  const txns = await prisma.serviceTransaction.findMany({ where: { createdAt: { gte: started }, providerTxnNo: { startsWith: "VT6-" } }, select: { id: true } });
  await prisma.dayBookEntry.deleteMany({
    where: { OR: [{ sourceId: { in: txns.map((t) => t.id) } }, { sourceType: "WalletRecharge", createdAt: { gte: started }, particulars: { endsWith: "· VT6-R" } }] },
  });
  await prisma.serviceTransaction.deleteMany({ where: { id: { in: txns.map((t) => t.id) } } });
  await prisma.messageLog.deleteMany({ where: { createdAt: { gte: started }, template: "low_wallet_balance", body: { contains: "needed ₹25,000" } } });
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: started }, action: "Recharge", summary: { contains: "VT6-R" } } });
  await prisma.serviceRate.deleteMany({ where: { effectiveFrom: { gte: new Date("2099-01-01T00:00:00Z") } } });
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: started }, entity: "ServiceRate" } });
  await prisma.$disconnect();
});

describe("Settings → ESEVAI & CSC rates (#46)", () => {
  it("a new rate takes over from its start date; a rate not yet started can be removed", async () => {
    const t = users.admin.tenantId;
    const eb = await prisma.serviceType.findFirstOrThrow({ where: { tenantId: t, code: "EB" } });
    const pan = await prisma.serviceType.findFirstOrThrow({ where: { tenantId: t, code: "PAN" } });
    const on = (d: string) => new Date(`${d}T00:00:00Z`);

    session.user = users.arun;
    await expect(saveServiceRate({ ok: false }, form({ serviceTypeId: eb.id, effectiveFrom: "2099-01-01" }))).rejects.toThrow(/Not allowed/);
    session.user = users.admin;
    try {
      // EB slab: a new bill range, then the same range with a new charge from a later date.
      expect((await saveServiceRate({ ok: false }, form({ serviceTypeId: eb.id, effectiveFrom: "2099-01-01", minAmount: "1000", maxAmount: "", serviceCharge: "15" }))).fieldErrors).toHaveProperty("maxAmount");
      expect((await saveServiceRate({ ok: false }, form({ serviceTypeId: eb.id, effectiveFrom: "2099-01-01", minAmount: "500", maxAmount: "1500", serviceCharge: "15" }))).error).toMatch(/Overlaps/);
      expect(await saveServiceRate({ ok: false }, form({ serviceTypeId: eb.id, effectiveFrom: "2099-01-01", minAmount: "1000", maxAmount: "1999.99", serviceCharge: "15" }))).toEqual({ ok: true });
      expect(await saveServiceRate({ ok: false }, form({ serviceTypeId: eb.id, effectiveFrom: "2099-06-01", minAmount: "1000", maxAmount: "1999.99", serviceCharge: "18" }))).toEqual({ ok: true });
      const slab = async (d: string) => (await ratesInForce(prisma as never, eb.id, on(d))).find((r) => r.minAmount?.equals(1000))?.serviceCharge?.toFixed(2);
      expect([await slab("2098-12-31"), await slab("2099-03-01"), await slab("2099-06-01")]).toEqual([undefined, "15.00", "18.00"]);

      // Fixed service: collected can't be below paid; the newest started rate is the one in force.
      expect((await saveServiceRate({ ok: false }, form({ serviceTypeId: pan.id, effectiveFrom: "2099-01-01", walletCost: "120", fixedCustomerAmount: "100" }))).fieldErrors).toHaveProperty("fixedCustomerAmount");
      expect(await saveServiceRate({ ok: false }, form({ serviceTypeId: pan.id, effectiveFrom: "2099-01-01", walletCost: "120", fixedCustomerAmount: "200" }))).toEqual({ ok: true });
      const fixed = (await ratesInForce(prisma as never, pan.id, on("2099-02-01"))).find((r) => r.fixedCustomerAmount !== null)!;
      expect([fixed.walletCost?.toFixed(2), fixed.fixedCustomerAmount?.toFixed(2)]).toEqual(["120.00", "200.00"]);

      // Not started yet → can be removed; a rate already in force can't.
      const future = await prisma.serviceRate.findFirstOrThrow({ where: { serviceTypeId: pan.id, effectiveFrom: on("2099-01-01") } });
      expect(await deleteServiceRate(future.id)).toEqual({ ok: true });
      const live = await prisma.serviceRate.findFirstOrThrow({ where: { serviceTypeId: pan.id, effectiveFrom: { lte: istToday() } } });
      expect((await deleteServiceRate(live.id)).error).toMatch(/already started/);
    } finally {
      session.user = users.arun;
    }
  });
});

describe("E-Sevai entries (#7)", () => {
  it("EB ₹850 collected ₹860 by UPI: ₹860 into the bank picked, ₹850 out of the EB wallet, service charge ₹10", async () => {
    const r = await createServiceEntry({ ok: false }, entry({ mode: "UPI", intoAccountId: acc.bank, reference: "UTR1" }));
    expect(r).toMatchObject({ ok: true, href: expect.stringMatching(/^\/api\/esevai\/.+\/pdf$/) });
    const t = await prisma.serviceTransaction.findUniqueOrThrow({ where: { id: r.id } });
    expect([t.customerAmount, t.walletCost, t.profit].map((d) => d.toFixed(2))).toEqual(["860.00", "850.00", "10.00"]);
    // No UTR or notes are kept on new entries (owner, 12 Nov 2026), even if an old form sends them.
    expect(t).toMatchObject({ providerTxnNo: "VT6-1", paidVia: "Wallet", receivedAccountId: acc.bank, reference: null, notes: null });
    const lines = await prisma.dayBookEntry.findMany({ where: { sourceId: r.id }, include: { account: true }, orderBy: { direction: "asc" } });
    expect(lines.map((l) => [l.direction, l.amount.toFixed(2), l.account.name])).toEqual([["In", "860.00", "SBI current ••1234"], ["Out", "850.00", "EB wallet"]]);
  });

  it("transaction no. is optional: a blank one saves as empty", async () => {
    const r = await createServiceEntry({ ok: false }, entry({ providerTxnNo: "" }));
    expect(r.ok).toBe(true);
    expect((await prisma.serviceTransaction.findUniqueOrThrow({ where: { id: r.id } })).providerTxnNo).toBeNull();
    await prisma.dayBookEntry.deleteMany({ where: { sourceId: r.id } });
    await prisma.serviceTransaction.delete({ where: { id: r.id } });
  });

  it("collected can't be below paid; cash notes must add up; Other needs its name", async () => {
    expect((await createServiceEntry({ ok: false }, entry({ collected: "800" }))).fieldErrors).toHaveProperty("collected");
    expect((await createServiceEntry({ ok: false }, entry({ denominations: notes(500) }))).fieldErrors).toHaveProperty("denominations");
    expect((await createServiceEntry({ ok: false }, entry({ serviceCode: "OTHER", providerRef: "" }))).fieldErrors).toHaveProperty("serviceName");
  });

  it("the rate table only suggests: an EB bill in the old ₹1,000–₹1,999 gap saves with the amount typed", async () => {
    const r = await createServiceEntry({ ok: false }, entry({ paidAmount: "1500", collected: "1515", providerTxnNo: "VT6-2" }));
    expect(r.ok).toBe(true);
    expect((await prisma.serviceTransaction.findUniqueOrThrow({ where: { id: r.id } })).profit.toFixed(2)).toBe("15.00");
  });

  it("blocks when the wallet is too low and alerts the Admins; GPay direct from the bank works instead", async () => {
    const r = await createServiceEntry({ ok: false }, entry({ paidAmount: "25000", collected: "25020", providerTxnNo: "VT6-3" }));
    expect(r.error).toMatch(/EB wallet has only/);
    expect(await prisma.messageLog.count({ where: { template: "low_wallet_balance", createdAt: { gte: started } } })).toBe(2);
    const bank = await createServiceEntry({ ok: false }, entry({ paidAmount: "25000", collected: "25020", paidVia: "GPay", paidFromAccountId: acc.bank, providerTxnNo: "VT6-3" }));
    expect(bank.ok).toBe(true);
    expect(await prisma.serviceTransaction.findUniqueOrThrow({ where: { id: bank.id } })).toMatchObject({ paidVia: "GPay", paidFromAccountId: acc.bank });
  });

  it("PAN can't be paid direct from the bank, but from any wallet", async () => {
    expect((await createServiceEntry({ ok: false }, entry({ serviceCode: "PAN", paidAmount: "100", collected: "200", paidVia: "NetBanking", paidFromAccountId: acc.bank, providerTxnNo: "VT6-4" }))).ok).toBe(false);
    const ok = await createServiceEntry({ ok: false }, entry({ serviceCode: "PAN", providerRef: "PAN-1", paidAmount: "100", collected: "200", paidFromAccountId: acc.cert, providerTxnNo: "VT6-4" }));
    expect(ok.ok).toBe(true);
  });

  it("a customer's mobile links the entry to them; Other services keep their typed name and count in P&L", async () => {
    const c = await prisma.customer.findFirstOrThrow({ where: { tenantId: users.admin.tenantId } });
    expect(await findCustomerByMobile(c.mobile)).toEqual({ id: c.id, name: c.name, cifNo: c.cifNo });
    expect(await findCustomerByMobile("12345")).toBeNull();
    const range = monthRange(monthKey(istToday()));
    const before = (await profitAndLoss(users.admin.tenantId, range)).serviceLines.find((l) => l.label === "Other service")?.amount.toNumber() ?? 0;
    const r = await createServiceEntry({ ok: false }, entry({
      serviceCode: "OTHER", serviceName: "Ration card", providerRef: "", customerMobile: c.mobile, gender: "Female", paidAmount: "30", collected: "80",
      paidFromAccountId: acc.cert, providerTxnNo: "VT6-5", notes: "Vitest",
    }));
    expect(r.ok).toBe(true);
    expect(await prisma.serviceTransaction.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ customerId: c.id, serviceName: "Ration card", gender: "Female", customerName: c.name });
    const after = (await profitAndLoss(users.admin.tenantId, range)).serviceLines.find((l) => l.label === "Other service")!.amount.toNumber();
    expect(after - before).toBe(50);
  });
});

describe("Entry date", () => {
  const day = (n: number) => new Date(istToday().getTime() + n * 86_400_000).toISOString().slice(0, 10);

  it("never a future day; a closed Day Book day is refused", async () => {
    expect((await createServiceEntry({ ok: false }, entry({ txnDate: day(1), providerTxnNo: "VT6-6" }))).fieldErrors).toHaveProperty("txnDate");
    const lastClose = await prisma.dayClose.findFirst({ where: { tenantId: users.admin.tenantId, status: "Closed" }, orderBy: { date: "desc" } });
    if (lastClose) {
      const r = await createServiceEntry({ ok: false }, entry({ txnDate: lastClose.date.toISOString().slice(0, 10), providerTxnNo: "VT6-6" }));
      expect(r.error).toMatch(/closed/);
    }
  });

  it("an earlier open day is used for the entry and its Day Book lines", async () => {
    // The seed closes yesterday: reopen it for this test only.
    const yesterday = new Date(`${day(-1)}T00:00:00Z`);
    const closes = await prisma.dayClose.findMany({ where: { tenantId: users.admin.tenantId, date: { gte: yesterday }, status: "Closed" } });
    await prisma.dayClose.updateMany({ where: { id: { in: closes.map((c) => c.id) } }, data: { status: "Open" } });
    try {
      const r = await createServiceEntry({ ok: false }, entry({ txnDate: day(-1), providerTxnNo: "VT6-6" }));
      expect(r.ok).toBe(true);
      expect((await prisma.serviceTransaction.findUniqueOrThrow({ where: { id: r.id } })).txnDate.toISOString().slice(0, 10)).toBe(day(-1));
      const lines = await prisma.dayBookEntry.findMany({ where: { sourceId: r.id } });
      expect(lines.every((l) => l.entryDate.toISOString().slice(0, 10) === day(-1))).toBe(true);
    } finally {
      await prisma.dayClose.updateMany({ where: { id: { in: closes.map((c) => c.id) } }, data: { status: "Closed" } });
    }
  });
});

describe("Entry time", () => {
  /** A ₹50 → ₹60 entry from the Certificate wallet (the EB wallet is used up by the tests above). */
  const small = (o: Record<string, string>) => entry({ paidAmount: "50", collected: "60", paidFromAccountId: acc.cert, ...o });
  it("keeps the time entered; blank = now; later than now today is refused", async () => {
    const r = await createServiceEntry({ ok: false }, small({ txnTime: "00:05", providerTxnNo: "VT6-7" }));
    expect(r.ok).toBe(true);
    expect((await prisma.serviceTransaction.findUniqueOrThrow({ where: { id: r.id } })).txnTime).toBe("00:05");
    const blank = await createServiceEntry({ ok: false }, small({ txnTime: "", providerTxnNo: "VT6-7" }));
    expect((await prisma.serviceTransaction.findUniqueOrThrow({ where: { id: blank.id } })).txnTime).toMatch(/^\d{2}:\d{2}$/);
    if (istNowHHMM() < "23:59") expect((await createServiceEntry({ ok: false }, small({ txnTime: "23:59", providerTxnNo: "VT6-7" }))).fieldErrors).toHaveProperty("txnTime");
    expect((await createServiceEntry({ ok: false }, small({ txnTime: "25:00", providerTxnNo: "VT6-7" }))).fieldErrors).toHaveProperty("txnTime");
  });
});

describe("Wallet recharge (#6)", () => {
  it("Admin only; from a company bank account with a transaction no.; a bank → wallet transfer", async () => {
    const f = (o: Record<string, string>) => form({ walletId: acc.cert, amount: "500", bankAccountId: acc.bank, reference: "VT6-R", ...o });
    await expect(rechargeWallet({ ok: false }, f({}))).rejects.toThrow(/Wallet.Recharge/);
    session.user = users.admin;
    try {
      expect((await rechargeWallet({ ok: false }, f({ reference: "" }))).error).toMatch(/transaction number/);
      expect((await rechargeWallet({ ok: false }, f({ bankAccountId: acc.eb }))).error).toMatch(/active bank account/);
      expect(await rechargeWallet({ ok: false }, f({}))).toEqual({ ok: true });
    } finally {
      session.user = users.arun;
    }
    const lines = await prisma.dayBookEntry.findMany({ where: { sourceType: "WalletRecharge", createdAt: { gte: started } }, include: { account: true } });
    expect(lines.map((l) => `${l.direction} ${l.account.name} ${l.amount.toFixed(2)}`).sort()).toEqual(["In Certificate wallet 500.00", "Out SBI current ••1234 500.00"]);
  });
});
