// Quotations with a "Mutual fund" product (3 Nov 2026): SIP / Lumpsum only, no cover, proposal is a mutual fund.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isoDate, istToday } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { isMfCategory, payModeLabel, rowHasNoCover } from "@/lib/products";

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

  it("no cover to show for mutual funds and post office investments; insurance and a PLI with cover keep it", () => {
    expect(rowHasNoCover({ category: "Mutual fund", sumInsured: null })).toBe(true);
    expect(rowHasNoCover({ category: " post OFFICE ", sumInsured: null })).toBe(true);
    expect(rowHasNoCover({ category: "Post office", sumInsured: "250000" })).toBe(false); // PLI with a cover
    for (const c of ["Life", "Health", "Personal accident"]) expect(rowHasNoCover({ category: c, sumInsured: null }), c).toBe(false);
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

  // Last on purpose: the test above reads "the" quotation made during this run.
  it("'Post office': a sum insured is kept only for PLI; every other plan (incl. one not in the catalogue) drops it", async () => {
    const post = (productName: string) => ({ category: "Post office", categoryOther: "", insurer: "Post Office", productName, sumInsured: "250000", premium: "1000", payMode: "Yearly" });
    // At most 5 products per quotation.
    const { url } = await quote([post("Post Office RD"), post("Post Office TD"), post("KVP"), post("NSC"), post("SCSS")]);
    expect(url).toMatch(/^\/quotations\//);
    const { url: second } = await quote([post("Post Office MIS"), post("Postal Life Insurance"), post("Some new scheme")]);
    expect(second).toMatch(/^\/quotations\//);
    const items = await prisma.quotationItem.findMany({ where: { quotation: { createdAt: { gte: started } }, category: "Post office" } });
    expect(items).toHaveLength(8);
    const noCover = ["Post Office RD", "Post Office TD", "KVP", "NSC", "SCSS", "Post Office MIS", "Some new scheme"];
    expect(items.filter((i) => noCover.includes(i.productName))).toHaveLength(7);
    expect(items.filter((i) => noCover.includes(i.productName)).every((i) => i.sumInsured === null)).toBe(true);
    expect(items.find((i) => i.productName === "Postal Life Insurance")?.sumInsured?.toString()).toBe("250000");
  });
});
