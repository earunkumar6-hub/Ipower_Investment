// Server-action tests against the seeded database. Every row they create is removed afterwards.
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

const { createServiceEntry, rechargeWallet } = await import("@/app/(app)/esevai/actions");

const started = new Date();
const users: Record<string, U> = {};
const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const entry = { baseAmount: "", paidFrom: "wallet", mode: "Cash", reference: "", providerRef: "TNEB-TEST", customerName: "", customerMobile: "" };

beforeAll(async () => {
  for (const username of ["arun", "admin"]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    users[username] = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
  }
  session.user = users.arun;
});

afterAll(async () => {
  // Only rows these tests made: their service entries (marked TNEB-TEST) and the UTR9 recharge.
  const txns = await prisma.serviceTransaction.findMany({ where: { createdAt: { gte: started }, providerRef: "TNEB-TEST" }, select: { id: true } });
  await prisma.dayBookEntry.deleteMany({
    where: {
      OR: [
        { sourceId: { in: txns.map((t) => t.id) } },
        { sourceType: "WalletRecharge", createdAt: { gte: started }, particulars: { endsWith: "· UTR9" } },
      ],
    },
  });
  await prisma.serviceTransaction.deleteMany({ where: { id: { in: txns.map((t) => t.id) } } });
  await prisma.messageLog.deleteMany({ where: { createdAt: { gte: started }, template: "low_wallet_balance", body: { contains: "needed ₹25,000" } } });
  await prisma.$disconnect();
});

describe("E-Sevai entries", () => {
  it("EB ₹850 collected by UPI: ₹860 into SBI, ₹850 out of the EB wallet, profit ₹10", async () => {
    const r = await createServiceEntry({ ok: false }, form({ ...entry, serviceCode: "EB", baseAmount: "850", mode: "UPI", reference: "UTR1" }));
    expect(r).toMatchObject({ ok: true });
    const t = await prisma.serviceTransaction.findUniqueOrThrow({ where: { id: r.id } });
    expect([t.customerAmount, t.walletCost, t.profit].map((d) => d.toFixed(2))).toEqual(["860.00", "850.00", "10.00"]);
    const lines = await prisma.dayBookEntry.findMany({ where: { sourceId: r.id }, include: { account: true }, orderBy: { direction: "asc" } });
    expect(lines.map((l) => [l.direction, l.amount.toFixed(2), l.account.name])).toEqual([
      ["In", "860.00", "SBI current ••1234"],
      ["Out", "850.00", "EB wallet"],
    ]);
  });

  it("refuses EB bills with no slab (₹1,000–₹1,999)", async () => {
    const r = await createServiceEntry({ ok: false }, form({ ...entry, serviceCode: "EB", baseAmount: "1500" }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No EB service charge/);
  });

  it("blocks when the wallet is too low and alerts the Admins", async () => {
    const r = await createServiceEntry({ ok: false }, form({ ...entry, serviceCode: "EB", baseAmount: "25000" }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/EB wallet has only/);
    expect(await prisma.messageLog.count({ where: { template: "low_wallet_balance", createdAt: { gte: started } } })).toBe(2);
    // The same bill can be paid straight from the bank instead
    const bank = await createServiceEntry({ ok: false }, form({ ...entry, serviceCode: "EB", baseAmount: "25000", paidFrom: "bank" }));
    expect(bank).toMatchObject({ ok: true });
  });

  it("PAN is always paid from its wallet", async () => {
    const r = await createServiceEntry({ ok: false }, form({ ...entry, serviceCode: "PAN", paidFrom: "bank" }));
    expect(r.ok).toBe(false);
    const ok = await createServiceEntry({ ok: false }, form({ ...entry, serviceCode: "PAN" }));
    const t = await prisma.serviceTransaction.findUniqueOrThrow({ where: { id: ok.id } });
    expect([t.customerAmount, t.walletCost, t.profit].map((d) => d.toFixed(2))).toEqual(["200.00", "100.00", "100.00"]);
  });

  it("only Admin can recharge; a recharge is a transfer from the bank to the wallet", async () => {
    const wallet = await prisma.account.findFirstOrThrow({ where: { name: "Certificate wallet" } });
    await expect(rechargeWallet({ ok: false }, form({ walletId: wallet.id, amount: "500", from: "Bank", reference: "" }))).rejects.toThrow(/Wallet.Recharge/);
    session.user = users.admin;
    const r = await rechargeWallet({ ok: false }, form({ walletId: wallet.id, amount: "500", from: "Bank", reference: "UTR9" }));
    session.user = users.arun;
    expect(r).toEqual({ ok: true });
    const lines = await prisma.dayBookEntry.findMany({ where: { sourceType: "WalletRecharge", createdAt: { gte: started } }, include: { account: true } });
    expect(lines.map((l) => `${l.direction} ${l.account.name} ${l.amount.toFixed(2)}`).sort()).toEqual([
      "In Certificate wallet 500.00",
      "Out SBI current ••1234 500.00",
    ]);
  });
});
