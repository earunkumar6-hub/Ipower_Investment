// Quotations with a "Mutual fund" product (3 Nov 2026): SIP / Lumpsum only, no cover, proposal is a mutual fund.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isoDate, istToday } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { isMfCategory, payModeLabel } from "@/lib/products";

type U = { id: string; name: string; username: string; role: "Admin" | "User" | "SuperAdmin"; tenantId: string };
const session = vi.hoisted(() => ({ user: null as null | U }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error("redirect"), { url }); } }));
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

const { createQuotation, createProposalsFromSelected } = await import("@/app/(app)/quotations/actions");

const started = new Date();
let arun: U;
let rajesh = { id: "", ownerId: "" };

const quote = (items: object[]) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ customerId: rajesh.id, leadId: "", customerName: "Rajesh Kumar", mobile: "9876500000", validUpto: isoDate(istToday()) })) f.append(k, v);
  f.append("items", JSON.stringify(items));
  return createQuotation({ ok: false }, f).then((r) => ({ result: r, url: null as string | null }), (e: { url?: string }) => {
    if (!e.url) throw e;
    return { result: null, url: e.url };
  });
};
const sip = { category: "Mutual fund", categoryOther: "", insurer: "HDFC MF", productName: "Flexi Cap SIP", sumInsured: "500000", premium: "5000", payMode: "Monthly" };

beforeAll(async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { username: "arun" } });
  arun = { id: u.id, name: u.name, username: "arun", role: u.role, tenantId: u.tenantId };
  rajesh = await prisma.customer.findFirstOrThrow({ where: { name: "Rajesh Kumar" }, select: { id: true, ownerId: true } });
  session.user = arun;
});

afterAll(async () => {
  const pids = (await prisma.proposal.findMany({ where: { createdAt: { gte: started } }, select: { id: true } })).map((p) => p.id);
  await prisma.proposal.deleteMany({ where: { id: { in: pids } } });
  await prisma.quotation.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.$disconnect();
});

describe("Mutual fund in quotations", () => {
  it("labels: SIP (monthly) / Lumpsum, other products unchanged", () => {
    expect(isMfCategory(" mutual FUND ")).toBe(true);
    expect(isMfCategory("Health")).toBe(false);
    expect([payModeLabel("Monthly", true), payModeLabel("OneTime", true), payModeLabel("Monthly", false)]).toEqual(["SIP (monthly)", "Lumpsum", "Monthly"]);
  });

  it("a mutual fund must be SIP or Lumpsum", async () => {
    const { result } = await quote([{ ...sip, payMode: "Yearly" }]);
    expect(result?.error).toBe("Product 1: pick SIP or Lumpsum");
  });

  it("saves without cover, and the proposal made from it is a mutual fund", async () => {
    const { url } = await quote([sip, { ...sip, insurer: "Some AMC", productName: "Not in catalogue", payMode: "OneTime" }]);
    expect(url).toMatch(/^\/quotations\//);
    const q = await prisma.quotation.findFirstOrThrow({ where: { createdAt: { gte: started } }, include: { items: { orderBy: { premium: "asc" } } } });
    expect(q.items.map((i) => [i.sumInsured, i.payMode])).toEqual([[null, "Monthly"], [null, "OneTime"]]);
    expect((await createProposalsFromSelected(q.id, q.items.map((i) => i.id))).ok).toBe(true);
    const proposals = await prisma.proposal.findMany({ where: { quotationId: q.id }, include: { product: true }, orderBy: { productName: "asc" } });
    // catalogue match ("Flexi Cap SIP") and a plan typed by hand are both mutual funds
    expect(proposals.map((p) => [p.productName, p.productType, p.product?.productType ?? null])).toEqual([
      ["Flexi Cap SIP", "MutualFund", "MutualFund"], ["Not in catalogue", "MutualFund", null],
    ]);
  });
});
