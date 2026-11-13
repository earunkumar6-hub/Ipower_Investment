// Every post office scheme except PLI (owner, 11 Nov 2026): no cover, and the premium / amount may be left blank on a
// quotation, a proposal and "Add product directly". PLI and everything else still need one; RD, SSA and PPF need it once
// the policy number is entered (their bills are made from it).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isoDate, istToday } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { isPostalInvestmentType, isPostOfficeInsurance, orderGroups, quoteGroup } from "@/lib/products";

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

const { createQuotation } = await import("@/app/(app)/quotations/actions");
const { savePolicyDetails, issuePolicy } = await import("@/app/(app)/proposals/actions");
const { addProductDirect } = await import("@/app/(app)/customers/actions");

const started = new Date();
const stamp = String(started.getTime() % 100000);
const today = isoDate(istToday());
let arun: U;
let rajesh = { id: "", name: "", mobile: "", ownerId: "" };

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};
const quote = (items: object[]) => {
  const f = form({ customerId: rajesh.id, leadId: "", customerName: "Rajesh Kumar", mobile: "9876500000", validUpto: today });
  f.append("items", JSON.stringify(items));
  return createQuotation({ ok: false }, f).then((r) => ({ result: r, url: null as string | null }), (e: { url?: string }) => {
    if (!e.url) throw e;
    return { result: null, url: e.url };
  });
};
// Product (category) → company → plan come from Settings → Products and schemes (#12); the pay mode must be one the plan allows.
const ONE_TIME = ["Post Office TD", "KVP", "NSC", "SCSS", "Post Office MIS"];
const item = (category: string, premium: string, insurer = "Post Office", productName = "Post Office RD") =>
  ({ category, insurer, productName, sumInsured: "", premium, payMode: productName === "Post Office RD" ? "Monthly" : ONE_TIME.includes(productName) ? "OneTime" : "Yearly" });

beforeAll(async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { username: "arun" } });
  arun = { id: u.id, name: u.name, username: "arun", role: u.role, tenantId: u.tenantId };
  session.user = arun;
  rajesh = await prisma.customer.findFirstOrThrow({ where: { name: "Rajesh Kumar" }, select: { id: true, name: true, mobile: true, ownerId: true } });
});

afterAll(async () => {
  const pids = (await prisma.proposal.findMany({ where: { createdAt: { gte: started } }, select: { id: true } })).map((p) => p.id);
  const polIds = (await prisma.policy.findMany({ where: { OR: [{ proposalId: { in: pids } }, { createdAt: { gte: started } }] }, select: { id: true } })).map((p) => p.id);
  await prisma.renewalItem.deleteMany({ where: { policyId: { in: polIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: polIds } } });
  await prisma.proposal.deleteMany({ where: { id: { in: pids } } });
  await prisma.quotation.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.$disconnect();
});

describe("which products", () => {
  it("every post office scheme type; PLI (Insurance) is not one", () => {
    for (const t of ["PoRd", "PoTd", "PoKvp", "PoNsc", "PoScss", "PoMis", "PoSsa", "PoPpf"] as const) expect(isPostalInvestmentType(t), t).toBe(true);
    for (const t of ["Insurance", "MutualFund", null, undefined] as const) expect(isPostalInvestmentType(t), String(t)).toBe(false);
  });

  it("a 'Post office' quotation row is insurance only for PLI", () => {
    expect(isPostOfficeInsurance("Insurance", "Postal Life Insurance")).toBe(true);
    expect(isPostOfficeInsurance(undefined, "Postal Life Insurance")).toBe(true);
    expect(isPostOfficeInsurance(undefined, "PLI Santosh")).toBe(true);
    for (const t of ["PoRd", "PoSsa", "PoPpf"] as const) expect(isPostOfficeInsurance(t, "x"), t).toBe(false);
    expect(isPostOfficeInsurance(undefined, "A scheme not in the catalogue")).toBe(false);
    expect(isPostOfficeInsurance(undefined, "")).toBe(false);
  });
});

describe("Quotation – 'Post office' follows the plan chosen", () => {
  it("saves RD / TD / KVP / NSC / SCSS without a premium (blank or 0); the total is 0", async () => {
    const { url } = await quote([item("Post office", ""), item("Post office", "", "Post Office", "Post Office TD"), item("Post office", "0", "Post Office", "KVP"), item("Post office", "", "Post Office", "NSC"), item("Post office", "", "Post Office", "SCSS")]);
    expect(url).toMatch(/^\/quotations\//);
    const q = await prisma.quotation.findFirstOrThrow({ where: { createdAt: { gte: started } }, include: { items: true } });
    expect(q.items).toHaveLength(5);
    expect(q.items.every((i) => i.premium.toNumber() === 0 && i.total.toNumber() === 0)).toBe(true);
    expect(q.total.toNumber()).toBe(0);
  });

  it("SSA and PPF save without a premium or cover", async () => {
    for (const name of ["SSA", "PPF"]) {
      const { url } = await quote([{ ...item("Post office", "", "Post Office", name), sumInsured: "500000" }]);
      expect(url, name).toMatch(/^\/quotations\//);
      const q = await prisma.quotation.findUniqueOrThrow({ where: { id: url!.split("/").pop() }, include: { items: true } });
      expect([q.items[0].premium.toNumber(), q.items[0].sumInsured], name).toEqual([0, null]);
    }
  });

  it("PLI and other products still need a premium above 0", async () => {
    expect((await quote([item("Post office", "", "Post Office", "Postal Life Insurance")])).result?.error).toBe("Product 1: Enter an amount");
    expect((await quote([item("Post office", "0", "Post Office", "Postal Life Insurance")])).result?.error).toBe("Product 1: Premium must be more than 0");
    expect((await quote([item("Health insurance", "0", "Care Health", "Care Supreme")])).result?.error).toBe("Product 1: Premium must be more than 0");
    expect((await quote([{ ...item("Mutual fund", "", "HDFC MF", "Flexi Cap SIP"), payMode: "Monthly" }])).result?.error).toBe("Product 1: Enter an amount");
    expect((await quote([item("Post office", "12x")])).result?.error).toBe("Product 1: Enter an amount");
  });

  it("only plans from Settings → Products and schemes, under their own category, with a pay mode they allow (#12)", async () => {
    const pick = "Product 1: pick a plan from Settings → Products and schemes";
    expect((await quote([item("RD", "")])).result?.error).toBe(pick); // not a category
    expect((await quote([item("Post office", "", "Post Office", "A scheme not in the catalogue")])).result?.error).toBe(pick);
    expect((await quote([item("Life insurance", "", "Post Office", "Post Office RD")])).result?.error).toBe(pick); // wrong category
    expect((await quote([{ ...item("Post office", ""), payMode: "Yearly" }])).result?.error).toBe("Product 1: pick a pay mode this plan allows");
  });

  it("a new category typed on a product becomes a new group (owner: more groups later)", async () => {
    expect(orderGroups(["Vitest motor", "Post office", "Mutual fund", "Accident", "Life insurance", "Health insurance"]))
      .toEqual(["Life insurance", "Health insurance", "Mutual fund", "Post office", "Accident", "Vitest motor"]);
    expect(quoteGroup({ productType: "Insurance", partner: "LIC", invoiceRule: "UntilPremiumTerm", category: null })).toBe("Life insurance");
    expect(quoteGroup({ productType: "Insurance", partner: "Post Office", invoiceRule: "UntilPremiumTerm", category: "" })).toBe("Post office"); // PLI
    expect(quoteGroup({ productType: "Insurance", partner: "Star Health", invoiceRule: "UntilClosed", category: " Vitest motor " })).toBe("Vitest motor");

    const p = await prisma.product.findFirstOrThrow({ where: { partner: "SBI Life", name: "eShield Next" } });
    await prisma.product.update({ where: { id: p.id }, data: { category: "Vitest term cover" } });
    try {
      const { url } = await quote([{ ...item("Vitest term cover", "9000", "SBI Life", "eShield Next"), sumInsured: "5000000" }]);
      expect(url).toMatch(/^\/quotations\//);
      const q = await prisma.quotation.findUniqueOrThrow({ where: { id: url!.split("/").pop() }, include: { items: true } });
      expect([q.items[0].category, q.items[0].sumInsured?.toString()]).toEqual(["Vitest term cover", "5000000"]);
      // Its old group no longer offers it.
      expect((await quote([item("Life insurance", "9000", "SBI Life", "eShield Next")])).result?.error).toBe("Product 1: pick a plan from Settings → Products and schemes");
    } finally {
      await prisma.product.update({ where: { id: p.id }, data: { category: p.category } });
    }
  });
});

describe("Add product directly", () => {
  const product = (name: string) => prisma.product.findFirstOrThrow({ where: { name }, include: { schemes: true, customFields: true } });

  it("KVP: blank amount is saved (as 0), with or without a policy number; no bills", async () => {
    const kvp = await product("KVP");
    const base = { customerId: rajesh.id, productId: kvp.id, schemeId: kvp.schemes[0].id, amount: "", startDate: today, frequency: "OneTime" };
    const draft = await addProductDirect({ ok: false }, form(base));
    expect(draft.ok).toBe(true);
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: draft.id } })).premium.toNumber()).toBe(0);
    const no = `KVP-OPT-${stamp}`;
    const r = await addProductDirect({ ok: false }, form({ ...base, policyNumber: no }));
    expect(r.ok).toBe(true);
    const policy = await prisma.policy.findUniqueOrThrow({ where: { id: r.id }, include: { renewals: true } });
    expect([policy.status, policy.premiumAmount.toNumber(), policy.renewals.length]).toEqual(["Active", 0, 0]);
  });

  it("RD: blank is fine until the policy number is entered, then the monthly amount is needed", async () => {
    const rd = await product("Post Office RD");
    const base = { customerId: rajesh.id, productId: rd.id, schemeId: rd.schemes[0].id, amount: "", startDate: today, frequency: "Monthly", [`cf_${rd.customFields[0].id}`]: "Chennai GPO" };
    expect((await addProductDirect({ ok: false }, form({ ...base, policyNumber: `RD-OPT-${stamp}` }))).fieldErrors).toHaveProperty("amount");
    expect((await addProductDirect({ ok: false }, form(base))).ok).toBe(true);
    expect((await addProductDirect({ ok: false }, form({ ...base, amount: "1000", policyNumber: `RD-OPT-${stamp}` }))).ok).toBe(true);
  });

  it("everything else still needs an amount above 0", async () => {
    const lic = await product("Jeevan Anand");
    const base = { customerId: rajesh.id, productId: lic.id, schemeId: lic.schemes[0].id, startDate: today, frequency: "Yearly" };
    expect((await addProductDirect({ ok: false }, form({ ...base, amount: "" }))).error).toBe("Enter the amount");
    expect((await addProductDirect({ ok: false }, form({ ...base, amount: "0" }))).error).toBe("Amount must be more than 0");
  });
});

describe("Proposal", () => {
  const make = async (productName: string, productType: "PoRd" | "PoTd" | "PoKvp" | "Insurance", partner: string, frequency: "Monthly" | "OneTime" | "Yearly") => {
    const p = await prisma.product.findFirstOrThrow({ where: { name: productName } });
    return prisma.proposal.create({
      data: {
        tenantId: arun.tenantId, proposalNo: `P-OPT${stamp}-${productType}`, customerId: rajesh.id, customerName: rajesh.name, mobile: rajesh.mobile,
        insurer: partner, productName, premium: "500", status: "Draft", ownerId: rajesh.ownerId, productType, productId: p.id, frequency,
      },
    });
  };
  const save = (proposalId: string, frequency: string, premium: string) => savePolicyDetails({ ok: false }, form({ proposalId, frequency, term: "", premiumPayingTerm: "", startDate: today, premium }));

  it("a post office scheme can clear the premium; insurance can't", async () => {
    const kvp = await make("KVP", "PoKvp", "Post Office", "OneTime");
    expect((await save(kvp.id, "OneTime", "")).ok).toBe(true);
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: kvp.id } })).premium.toNumber()).toBe(0);
    expect((await save(kvp.id, "OneTime", "abc")).error).toBe("Enter the amount");
    const lic = await make("Jeevan Anand", "Insurance", "LIC", "Yearly");
    expect((await save(lic.id, "Yearly", "")).error).toBe("Enter the premium");
    expect((await save(lic.id, "Yearly", "0")).error).toBe("Premium must be more than 0");
  });

  it("issuing: KVP with no premium is fine (no bills); an RD needs the premium first", async () => {
    const kvp = await prisma.proposal.findFirstOrThrow({ where: { proposalNo: `P-OPT${stamp}-PoKvp` } });
    expect((await issuePolicy({ ok: false }, form({ proposalId: kvp.id, policyNumber: `KVP-P-${stamp}` }))).ok).toBe(true);
    const policy = await prisma.policy.findFirstOrThrow({ where: { proposalId: kvp.id }, include: { renewals: true } });
    expect([policy.premiumAmount.toNumber(), policy.renewals.length]).toEqual([0, 0]);

    const rd = await make("Post Office RD", "PoRd", "Post Office", "Monthly");
    expect((await save(rd.id, "Monthly", "")).ok).toBe(true);
    // Post office schemes call it the account number (owner, 13 Nov 2026); PLI and other insurance keep "policy number".
    expect((await issuePolicy({ ok: false }, form({ proposalId: rd.id, policyNumber: `RD-P-${stamp}` }))).error).toBe("Fill in before the account number: amount (the monthly RD instalment)");
    const { policyNumberLabel } = await import("@/app/(app)/proposals/labels");
    expect(["PoRd", "PoTd", "PoKvp", "PoSsa", "Insurance", "MutualFund"].map(policyNumberLabel))
      .toEqual(["Account number", "Account number", "Account number", "Account number", "Policy number", "Folio number"]);
    expect((await save(rd.id, "Monthly", "700")).ok).toBe(true);
    expect((await issuePolicy({ ok: false }, form({ proposalId: rd.id, policyNumber: `RD-P-${stamp}` }))).ok).toBe(true);
  });
});
