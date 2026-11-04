// Mutual fund SIP date (3 Nov 2026): required for a monthly mutual fund; bills fall on that day each month.
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, isoDate, istToday } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { payableDues, seriesAnchor } from "@/lib/dues";
import { fullSchedule } from "@/lib/policies";
import { sipDateLabel } from "@/lib/products";

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

const { saveProposal } = await import("@/app/(app)/proposals/actions");
const { addProductDirect } = await import("@/app/(app)/customers/actions");

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (x: Date) => isoDate(x);
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};
const started = new Date();
let arun: U;
let rajesh = { id: "", ownerId: "", name: "", mobile: "" };

beforeAll(async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { username: "arun" } });
  arun = { id: u.id, name: u.name, username: "arun", role: u.role, tenantId: u.tenantId };
  rajesh = await prisma.customer.findFirstOrThrow({ where: { name: "Rajesh Kumar" }, select: { id: true, ownerId: true, name: true, mobile: true } });
  session.user = arun;
});

afterAll(async () => {
  const policies = await prisma.policy.findMany({ where: { createdAt: { gte: started } }, select: { id: true } });
  await prisma.renewalItem.deleteMany({ where: { policyId: { in: policies.map((p) => p.id) } } });
  await prisma.policy.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.proposal.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.$disconnect();
});

describe("SIP date: bill dates", () => {
  it("the first bill is the first SIP date after the start", () => {
    expect(iso(seriesAnchor({ startDate: d("2026-11-03"), sipDay: 25 }))).toBe("2026-10-25");
    expect(iso(seriesAnchor({ startDate: d("2026-11-20"), sipDay: 5 }))).toBe("2026-11-05");
    expect(iso(seriesAnchor({ startDate: d("2026-01-10"), sipDay: 28 }))).toBe("2025-12-28");
    expect(iso(seriesAnchor({ startDate: d("2026-11-03"), sipDay: null }))).toBe("2026-11-03");
    expect(sipDateLabel(1) + " / " + sipDateLabel(22) + " / " + sipDateLabel(13)).toBe("1st of every month / 22nd of every month / 13th of every month");
  });

  it("advance dues and the schedule follow the SIP date", () => {
    const today = istToday();
    const startDate = addDays(today, -40);
    const sip = { startDate, sipDay: 7, frequency: "Monthly" as const, termMonths: null, premiumAmount: new Prisma.Decimal(5000), productType: "MutualFund" as const };
    const dues = payableDues({ ...sip, billUntil: null }, [], today);
    expect(dues.length).toBeGreaterThan(10);
    expect(dues.every((x) => x.dueDate.getUTCDate() === 7)).toBe(true);
    const renewals = fullSchedule(sip, "None", [], today).filter((r) => r.type === "Renewal");
    expect(renewals.length).toBeGreaterThan(10);
    expect(renewals.every((r) => r.date.getUTCDate() === 7 && r.date > startDate)).toBe(true);
  });
});

describe("SIP date: entry", () => {
  it("proposal: required for a SIP, kept on the policy; Lumpsum has none", async () => {
    const product = await prisma.product.findFirstOrThrow({ where: { tenantId: arun.tenantId, productType: "MutualFund", name: "Flexi Cap SIP", partner: "HDFC MF" } });
    const make = () => prisma.proposal.create({
      data: {
        tenantId: arun.tenantId, proposalNo: `P-SIP${Date.now() % 1_000_000}${Math.floor(Math.random() * 100)}`, customerId: rajesh.id, customerName: rajesh.name, mobile: rajesh.mobile,
        insurer: product.partner, productName: product.name, premium: "5000.00", status: "Draft", ownerId: rajesh.ownerId, productType: "MutualFund", productId: product.id,
      },
    });
    const p = await make();
    const base = { proposalId: p.id, frequency: "Monthly", term: "", premiumPayingTerm: "", startDate: iso(istToday()), schemeId: "", policyNumber: "" };
    expect((await saveProposal({ ok: false }, form({ ...base, sipDay: "" }))).error).toBe("Pick the SIP date (1–28)");
    expect((await saveProposal({ ok: false }, form({ ...base, sipDay: "29" }))).error).toBe("Pick the SIP date (1–28)");
    expect((await saveProposal({ ok: false }, form({ ...base, sipDay: "10", policyNumber: `SIP-T-${Date.now() % 100000}` }))).ok).toBe(true);
    expect(await prisma.policy.findFirstOrThrow({ where: { proposalId: p.id } })).toMatchObject({ sipDay: 10, frequency: "Monthly" });

    const lump = await make();
    expect((await saveProposal({ ok: false }, form({ ...base, proposalId: lump.id, frequency: "OneTime", sipDay: "10" }))).ok).toBe(true);
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: lump.id } })).sipDay).toBeNull();
  });

  it("add product directly: a SIP needs the SIP date", async () => {
    const product = await prisma.product.findFirstOrThrow({ where: { tenantId: arun.tenantId, productType: "MutualFund", name: "Bluechip SIP", partner: "SBI MF" } });
    const base = { customerId: rajesh.id, productId: product.id, schemeId: (await prisma.scheme.findFirstOrThrow({ where: { productId: product.id } })).id, amount: "3000", frequency: "Monthly", startDate: iso(istToday()), term: "", policyNumber: `SIPD-${Date.now() % 100000}` };
    const missing = await addProductDirect({ ok: false }, form({ ...base, sipDay: "" }));
    expect([missing.error, missing.fieldErrors?.sipDay]).toEqual(["Pick the SIP date (1–28)", "Required"]);
    expect((await addProductDirect({ ok: false }, form({ ...base, sipDay: "5" }))).ok).toBe(true);
    expect((await prisma.policy.findFirstOrThrow({ where: { policyNumber: base.policyNumber } })).sipDay).toBe(5);
  });
});
