// Phase 4 (Oct 2026 round 2): customer details and mobiles, Customer 360 holdings / cards / linked entries,
// and customers matched or created from proposals with all their numbers.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setAccessOverrides } from "@/lib/permissions";
import { addMonths, isoDate, istToday } from "@/lib/dates";
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

const { editCustomer, addProductDirect } = await import("@/app/(app)/customers/actions");
const { issuePolicy } = await import("@/app/(app)/proposals/actions");
const { loadCustomer360 } = await import("@/lib/customer-360");

const started = new Date();
const today = istToday();
const users = {} as Record<"arun" | "divya", U>;
const as = (u: U) => { session.user = u; };
const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
let rajesh: { id: string; name: string; mobile: string; email: string | null; address: string | null; ownerId: string; mobiles: { number: string; isWhatsApp: boolean }[] };
const createdCustomers: string[] = [];
const createdLeads: string[] = [];

beforeAll(async () => {
  for (const k of ["arun", "divya"] as const) {
    const u = await prisma.user.findFirstOrThrow({ where: { username: k } });
    users[k] = { id: u.id, name: u.name, username: k, role: u.role, tenantId: u.tenantId };
  }
  rajesh = await prisma.customer.findFirstOrThrow({ where: { name: "Rajesh Kumar" }, include: { mobiles: { orderBy: { sort: "asc" } } } });
});

afterAll(async () => {
  // put Rajesh back as seeded
  await prisma.customer.update({ where: { id: rajesh.id }, data: { name: rajesh.name, mobile: rajesh.mobile, email: rajesh.email, address: rajesh.address } });
  await prisma.customerMobile.deleteMany({ where: { customerId: rajesh.id } });
  await prisma.customerMobile.createMany({ data: rajesh.mobiles.map((m, sort) => ({ tenantId: users.arun.tenantId, customerId: rajesh.id, number: m.number, isWhatsApp: m.isWhatsApp, sort })) });
  const policies = await prisma.policy.findMany({ where: { createdAt: { gte: started } }, select: { id: true } });
  await prisma.renewalItem.deleteMany({ where: { policyId: { in: policies.map((p) => p.id) } } });
  await prisma.policy.deleteMany({ where: { id: { in: policies.map((p) => p.id) } } });
  const proposals = await prisma.proposal.findMany({ where: { createdAt: { gte: started } }, select: { id: true } });
  await prisma.consent.deleteMany({ where: { proposalId: { in: proposals.map((p) => p.id) } } });
  await prisma.proposal.deleteMany({ where: { id: { in: proposals.map((p) => p.id) } } });
  await prisma.quotation.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.customer.deleteMany({ where: { id: { in: createdCustomers } } });
  await prisma.lead.deleteMany({ where: { id: { in: createdLeads } } });
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.$disconnect();
});

describe("Customer details", () => {
  it("owner corrects name and numbers; the change log keeps the old values; others can't", async () => {
    const edit = (o: Record<string, string | string[]>) => editCustomer({ ok: false }, form({ customerId: rajesh.id, name: "Rajesh Kumar S", email: "rk@example.com", address: "Adyar", mobile: [rajesh.mobile, "9445099999"], whatsApp: ["1"], ...o }));
    as(users.divya);
    setAccessOverrides({ User: { "Records.SeeAll": false } }); // #10: only when 'work on every customer' is off
    expect((await edit({})).error).toMatch(/another user/);
    setAccessOverrides({});
    as(users.arun);
    expect((await edit({ mobile: ["123"] })).error).toMatch(/10-digit/);
    expect((await edit({ email: "not-an-email" })).fieldErrors).toHaveProperty("email");
    expect((await edit({})).ok).toBe(true);
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: rajesh.id }, include: { mobiles: { orderBy: { sort: "asc" } } } });
    expect([c.name, c.mobile, c.mobiles.map((m) => [m.number, m.isWhatsApp])]).toEqual(["Rajesh Kumar S", rajesh.mobile, [[rajesh.mobile, false], ["9445099999", true]]]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: rajesh.id, action: "Updated" } });
    expect((log.before as Record<string, string>).name).toBe("Rajesh Kumar");
  });
});

describe("Customer 360", () => {
  it("holdings show scheme, tenure, lock-in and maturity; cards add up; E-Sevai entries link by mobile", async () => {
    const d = (await loadCustomer360(users.arun as SessionUser, rajesh.id))!;
    const td = d.holdings.find((h) => h.productType === "PoTd")!;
    expect(td.schemeName).toBe("TD 5 years");
    expect(td.maturity?.getTime()).toBe(addMonths(td.startDate, 60).getTime());
    expect(td.lockIn?.getTime()).toBe(addMonths(td.startDate, 6).getTime());
    // insurance premium a year: SBI Life 30,000 + Star Health 16,800 (both yearly)
    expect(d.cards.yearlyPremium.toFixed(2)).toBe("46800.00");
    expect(d.oneTimeTotal.toFixed(2)).toBe("100000.00");
    expect(d.cards.investments.gte(100000)).toBe(true);
    expect(d.services.some((s) => s.customerMobile === rajesh.mobile && s.serviceType.name === "EB bill")).toBe(true);
  });

  it("bank details show masked; the full account number is never in the page data", async () => {
    const td = await prisma.product.findFirstOrThrow({ where: { name: "Post Office TD" }, include: { schemes: true, customFields: true } });
    as(users.arun);
    const r = await addProductDirect({ ok: false }, form({
      customerId: rajesh.id, productId: td.id, schemeId: td.schemes[0].id, policyNumber: `TD T${Date.now() % 100000}`, amount: "50000", startDate: isoDate(today), frequency: "OneTime",
      [`cf_${td.customFields.find((f) => f.required)!.id}`]: "Mylapore", bank_holder: "Rajesh", bank_bank: "SBI", bank_branch: "Adyar", bank_ifsc: "SBIN0001234", bank_accountNo: "123456789012",
    }));
    expect(r.ok).toBe(true);
    const d = (await loadCustomer360(users.arun as SessionUser, rajesh.id))!;
    const bank = d.holdings.find((h) => h.id === r.id)!.details.find(([k]) => k === "Bank")![1];
    expect(bank).toContain("A/c XXXXXXXX9012");
    expect(JSON.stringify(d.holdings)).not.toContain("123456789012");
  });
});

describe("Customers from proposals", () => {
  const proposal = (data: Partial<Parameters<typeof prisma.proposal.create>[0]["data"]>) => prisma.proposal.create({
    data: {
      tenantId: users.arun.tenantId, proposalNo: `P-T${Math.floor(Math.random() * 1e6)}`, customerName: "x", mobile: "9000000000", insurer: "Star Health", productName: "Comprehensive",
      premium: "12000.00", status: "Draft", ownerId: users.arun.id, frequency: "Yearly", startDate: today, termMonths: 12, sumInsured: "500000", premiumPayingTermMonths: 12, ...data,
    } as Parameters<typeof prisma.proposal.create>[0]["data"],
  });

  it("an existing customer is found by any of their numbers", async () => {
    as(users.arun);
    const p = await proposal({ customerName: "Rajesh Kumar", mobile: "9445099999" }); // his second number (added above)
    expect((await issuePolicy({ ok: false }, form({ proposalId: p.id, policyNumber: `STAR-T-${Date.now() % 100000}` }))).ok).toBe(true);
    expect((await prisma.policy.findFirstOrThrow({ where: { proposalId: p.id } })).customerId).toBe(rajesh.id);
  });

  it("a new customer gets the lead's numbers, email and address", async () => {
    as(users.arun);
    const lead = await prisma.lead.create({
      data: {
        tenantId: users.arun.tenantId, leadNo: `L-T${Date.now() % 100000}`, name: "Test Lead", firstName: "Test", mobile: "9876512340", source: "Direct", ownerId: users.arun.id,
        email: "lead@example.com", address: "Velachery", mobiles: { create: [{ tenantId: users.arun.tenantId, number: "9876512340", isWhatsApp: false, sort: 0 }, { tenantId: users.arun.tenantId, number: "9876512341", isWhatsApp: true, sort: 1 }] },
      },
    });
    createdLeads.push(lead.id);
    const q = await prisma.quotation.create({
      data: { tenantId: users.arun.tenantId, quoteNo: `Q-T${Date.now() % 100000}`, leadId: lead.id, customerName: "Test Lead", mobile: "9876512340", validUpto: today, subtotal: "1", total: "1", ownerId: users.arun.id },
    });
    const p = await proposal({ customerName: "Test Lead", mobile: "9876512340", quotationId: q.id, status: "ConsentGiven", panMasked: "ABCxxxxx4M" });
    await prisma.consent.create({ data: { tenantId: users.arun.tenantId, proposalId: p.id, mobile: "9876512340", purpose: "test", textVersion: "t", expiresOn: addMonths(today, 1), status: "Given" } });
    expect((await issuePolicy({ ok: false }, form({ proposalId: p.id, policyNumber: `STAR-L-${Date.now() % 100000}` }))).ok).toBe(true);
    const c = await prisma.customer.findFirstOrThrow({ where: { policies: { some: { proposalId: p.id } } }, include: { mobiles: { orderBy: { sort: "asc" } } } });
    createdCustomers.push(c.id);
    expect([c.email, c.address, c.mobiles.map((m) => [m.number, m.isWhatsApp])]).toEqual(["lead@example.com", "Velachery", [["9876512340", false], ["9876512341", true]]]);
  });
});

describe("Customers list holdings filter", () => {
  it("product → company → scheme and status narrow the list to customers holding it", async () => {
    const { customerFilter } = await import("@/lib/lists");
    const find = (sp: Record<string, string>) => prisma.customer.findMany({ where: customerFilter(users.arun as SessionUser, sp).where, include: { policies: true } });
    const td = await find({ product: "po", scheme: "PoTd" });
    expect(td.length).toBeGreaterThan(0);
    expect(td.every((c) => c.policies.some((p) => p.productType === "PoTd"))).toBe(true);
    // #10: staff see every customer; only their own once 'work on every customer' is switched off.
    setAccessOverrides({ User: { "Records.SeeAll": false } });
    expect((await find({ product: "po", scheme: "PoTd" })).every((c) => c.ownerId === users.arun.id)).toBe(true);
    setAccessOverrides({});
    const star = await find({ product: "insurance", company: "Star Health" });
    expect(star.every((c) => c.policies.some((p) => p.partner === "Star Health"))).toBe(true);
    // a scheme only applies under its product: RD isn't a company plan
    expect(customerFilter(users.arun as SessionUser, { product: "insurance", scheme: "PoRd" }).holdingWhere).toEqual({ productType: "Insurance", productName: "PoRd" });
    expect(customerFilter(users.arun as SessionUser, { product: "po", scheme: "Jeevan Anand" }).holdingWhere).toEqual({ productType: { in: expect.arrayContaining(["PoRd", "PoTd"]) } });
    const f = customerFilter(users.arun as SessionUser, { product: "po", scheme: "PoTd", status: "Active" });
    expect([f.filtered, f.filterLabel]).toEqual([true, "Post office · TD · Active"]);
    expect(customerFilter(users.arun as SessionUser, {}).filtered).toBe(false);
  });
});
