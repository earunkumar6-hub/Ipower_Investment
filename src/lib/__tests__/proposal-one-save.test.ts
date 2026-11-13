// Proposal "Save proposal" (3 Nov 2026): one Save for policy details, account holders, Aadhaar / PAN and the policy number.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isoDate, istToday } from "@/lib/dates";
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

const { saveProposal } = await import("@/app/(app)/proposals/actions");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};
const started = new Date();
const stamp = String(started.getTime() % 10000).padStart(4, "0");
let arun: U;
let proposalId = "";
// Issuing copies Aadhaar / PAN and consent to the customer: put Rajesh's back afterwards.
let rajeshId = "";
let rajeshIdentity = {};

beforeAll(async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { username: "arun" } });
  arun = { id: u.id, name: u.name, username: "arun", role: u.role, tenantId: u.tenantId };
  session.user = arun;
  const rajesh = await prisma.customer.findFirstOrThrow({ where: { name: "Rajesh Kumar" } });
  rajeshId = rajesh.id;
  const { panMasked, aadhaarLast4, panEnc, panHash, aadhaarEnc, aadhaarHash, consentAt, consentById } = rajesh;
  rajeshIdentity = { panMasked, aadhaarLast4, panEnc, panHash, aadhaarEnc, aadhaarHash, consentAt, consentById };
  const product = await prisma.product.findFirstOrThrow({ where: { tenantId: arun.tenantId, partner: "LIC", name: "Jeevan Anand" } });
  proposalId = (await prisma.proposal.create({
    data: {
      tenantId: arun.tenantId, proposalNo: `P-ONE${stamp}`, customerId: rajesh.id, customerName: rajesh.name, mobile: rajesh.mobile,
      insurer: "Post Office", productName: product.name, premium: "12000.00", status: "Draft", ownerId: rajesh.ownerId, productType: "Insurance", productId: product.id, frequency: "Yearly",
    },
  })).id;
});

afterAll(async () => {
  const policies = await prisma.policy.findMany({ where: { proposalId }, select: { id: true } });
  await prisma.renewalItem.deleteMany({ where: { policyId: { in: policies.map((p) => p.id) } } });
  await prisma.policy.deleteMany({ where: { proposalId } });
  await prisma.customer.update({ where: { id: rajeshId }, data: rajeshIdentity });
  await prisma.proposal.deleteMany({ where: { id: proposalId } });
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.$disconnect();
});

const base = () => ({ proposalId, frequency: "Yearly", term: "", premiumPayingTerm: "", startDate: "", schemeId: "", sipDay: "", policyNumber: "", jointAccount: "off", firstHolderCif: "", secondHolderCif: "", secondHolderId: "" });
const logLines = () => prisma.auditLog.count({ where: { entityId: proposalId, createdAt: { gte: started } } });

describe("Save proposal", () => {
  it("before the start date: saves holders and Aadhaar / PAN, not the details", async () => {
    const r = await saveProposal({ ok: false }, form({ ...base(), firstHolderCif: `cif-one-${stamp}`, consent: "on", pan: `ONEPA${stamp}Q` }));
    expect(r).toMatchObject({ ok: true, message: "Proposal saved – add the start date before the policy number" });
    const p = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect([p.firstHolderCif, p.panMasked, !!p.consentAt, p.startDate]).toEqual([`CIF-ONE-${stamp}`, `ONExxxxx${stamp.slice(-1)}Q`, true, null]);
  });

  it("CIF only for post office products; mutual funds: the folio number issues them (no policy number box)", async () => {
    const make = (insurer: string, productType: "Insurance" | "MutualFund", customerId?: string) => prisma.proposal.create({
      data: { tenantId: arun.tenantId, proposalNo: `P-ONE${stamp}-${productType}`, customerId, customerName: "Vitest", mobile: "6000033344", insurer, productName: "Vitest plan", premium: "100", status: "Draft", ownerId: arun.id, productType },
    });
    const lic = await make("LIC", "Insurance"), mf = await make("HDFC MF", "MutualFund", rajeshId);
    try {
      expect((await saveProposal({ ok: false }, form({ ...base(), proposalId: lic.id, firstHolderCif: "LIC-CIF-1", folioNo: "F-1" }))).ok).toBe(true);
      expect(await prisma.proposal.findUniqueOrThrow({ where: { id: lic.id } })).toMatchObject({ firstHolderCif: null, folioNo: null });
      // The folio issues, so the start date is needed first (as with a typed policy number).
      expect((await saveProposal({ ok: false }, form({ ...base(), proposalId: mf.id, folioNo: "f-777/1" }))).error).toBe("Pick the start date");
      const r = await saveProposal({ ok: false }, form({ ...base(), proposalId: mf.id, frequency: "OneTime", startDate: isoDate(istToday()), firstHolderCif: "MF-CIF-1", folioNo: "f-777/1" }));
      expect(r).toMatchObject({ ok: true, message: "Policy issued; customer and renewals created" });
      expect(await prisma.proposal.findUniqueOrThrow({ where: { id: mf.id } })).toMatchObject({ status: "Issued", firstHolderCif: null, folioNo: "F-777/1", policyNumber: `F-777/1-P-ONE${stamp}-MUTUALFUND` });
      expect(await prisma.policy.findFirstOrThrow({ where: { proposalId: mf.id } })).toMatchObject({ folioNo: "F-777/1", policyNumber: `F-777/1-P-ONE${stamp}-MUTUALFUND` });
    } finally {
      const made = await prisma.policy.findMany({ where: { proposalId: mf.id }, select: { id: true } });
      await prisma.renewalItem.deleteMany({ where: { policyId: { in: made.map((m) => m.id) } } });
      await prisma.policy.deleteMany({ where: { id: { in: made.map((m) => m.id) } } });
      await prisma.auditLog.deleteMany({ where: { entityId: { in: [lic.id, mf.id] } } });
      await prisma.proposal.deleteMany({ where: { id: { in: [lic.id, mf.id] } } });
    }
  });

  it("saving again with nothing changed writes no change-log lines", async () => {
    const before = await logLines();
    expect((await saveProposal({ ok: false }, form({ ...base(), firstHolderCif: `CIF-ONE-${stamp}` }))).ok).toBe(true);
    expect(await logLines()).toBe(before);
  });

  it("a refusal stops the rest and says what was already saved", async () => {
    const today = isoDate(istToday());
    expect((await saveProposal({ ok: false }, form({ ...base(), jointAccount: "on" }))).error).toBe("Pick the second holder, or untick Joint account");
    expect((await saveProposal({ ok: false }, form({ ...base(), startDate: today, term: "20", jointAccount: "on", policyNumber: "LIC-NO-ISSUE" }))).error)
      .toBe("Fill in before the policy number: sum assured, plan, premium paying term");
    const plan20 = await prisma.scheme.findFirstOrThrow({ where: { name: "Plan 20 years", product: { name: "Jeevan Anand" } } });
    const r = await saveProposal({ ok: false }, form({ ...base(), startDate: today, term: "20", premiumPayingTerm: "15", schemeId: plan20.id, sumInsured: "800000", jointAccount: "on", policyNumber: "LIC-NO-ISSUE" }));
    expect(r.error).toBe("Pick the second holder, or untick Joint account (policy details saved)");
    expect(await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } })).toMatchObject({ status: "Draft", termMonths: 240 });
    expect((await saveProposal({ ok: false }, form({ ...base(), startDate: today, aadhaar: "1234" }))).error).toBe("Aadhaar number is not valid: 12 digits, not starting with 0 or 1, with the correct last (check) digit (policy details and account holders saved)");
  });

  it("add product directly: insurance with a policy number needs the sum assured (health: no term / PPT)", async () => {
    const { addProductDirect } = await import("@/app/(app)/customers/actions");
    const care = await prisma.product.findFirstOrThrow({ where: { tenantId: arun.tenantId, name: "Care Supreme" }, include: { schemes: true } });
    const rajesh = await prisma.customer.findUniqueOrThrow({ where: { id: rajeshId } });
    const add = (o: Record<string, string>) => addProductDirect({ ok: false }, form({ customerId: rajesh.id, productId: care.id, schemeId: care.schemes[0].id, amount: "15000", frequency: "Yearly", startDate: isoDate(istToday()), term: "", ...o }));
    const r = await add({ policyNumber: `CARE-ONE-${stamp}`, sumAssured: "" });
    expect([r.error, r.fieldErrors]).toEqual(["Fill in before the policy number: sum assured", { sumAssured: "Required" }]);
    const ok = await add({ policyNumber: `CARE-ONE-${stamp}`, sumAssured: "500000" });
    expect(ok.ok).toBe(true);
    const policy = await prisma.policy.findFirstOrThrow({ where: { policyNumber: `CARE-ONE-${stamp}` } });
    expect(policy.sumAssured?.toString()).toBe("500000");
    await prisma.renewalItem.deleteMany({ where: { policyId: policy.id } });
    await prisma.policy.delete({ where: { id: policy.id } });
  });

  it("add product directly: post office accounts take the holder CIF (unique per company); insurance ignores it", async () => {
    const { addProductDirect } = await import("@/app/(app)/customers/actions");
    const kvp = await prisma.product.findFirstOrThrow({ where: { tenantId: arun.tenantId, name: "KVP" }, include: { schemes: true } });
    const care = await prisma.product.findFirstOrThrow({ where: { tenantId: arun.tenantId, name: "Care Supreme" }, include: { schemes: true } });
    const other = await prisma.customer.findFirstOrThrow({ where: { tenantId: arun.tenantId, ownerId: arun.id, id: { not: rajeshId } } });
    const add = (customerId: string, product: typeof kvp, o: Record<string, string>) => addProductDirect({ ok: false }, form({
      customerId, productId: product.id, schemeId: product.schemes[0].id, amount: "10000", frequency: product.payModes[0], startDate: isoDate(istToday()), term: "", ...o,
    }));
    const cif = `PO-ONE-${stamp}`;
    expect((await add(rajeshId, kvp, { policyNumber: `KVP-ONE-${stamp}`, firstHolderCif: cif.toLowerCase() })).ok).toBe(true);
    expect((await prisma.policy.findFirstOrThrow({ where: { policyNumber: `KVP-ONE-${stamp}` } })).firstHolderCif).toBe(cif);
    const dup = await add(other.id, kvp, { policyNumber: `KVP-TWO-${stamp}`, firstHolderCif: cif });
    expect([dup.ok, dup.fieldErrors?.firstHolderCif, dup.duplicate?.customerId]).toEqual([false, "Already used", rajeshId]);
    expect((await add(rajeshId, care, { policyNumber: `CARE-CIF-${stamp}`, sumAssured: "300000", firstHolderCif: "IGNORED-1" })).ok).toBe(true);
    expect((await prisma.policy.findFirstOrThrow({ where: { policyNumber: `CARE-CIF-${stamp}` } })).firstHolderCif).toBeNull();
    const made = await prisma.policy.findMany({ where: { policyNumber: { in: [`KVP-ONE-${stamp}`, `CARE-CIF-${stamp}`] } }, select: { id: true } });
    await prisma.renewalItem.deleteMany({ where: { policyId: { in: made.map((m) => m.id) } } });
    await prisma.policy.deleteMany({ where: { id: { in: made.map((m) => m.id) } } });
  });

  it("with the policy number: everything saved and the policy issued with the holder CIF and PAN", async () => {
    const plan20 = await prisma.scheme.findFirstOrThrow({ where: { name: "Plan 20 years", product: { name: "Jeevan Anand" } } });
    const r = await saveProposal({ ok: false }, form({ ...base(), startDate: isoDate(istToday()), term: "20", premiumPayingTerm: "15", schemeId: plan20.id, sumInsured: "800000", premium: "12000", firstHolderCif: `CIF-ONE-${stamp}`, policyNumber: `lic-one-${stamp}` }));
    expect(r).toMatchObject({ ok: true, message: "Policy issued; customer and renewals created" });
    const policy = await prisma.policy.findFirstOrThrow({ where: { proposalId }, include: { customer: true } });
    expect([policy.policyNumber, policy.firstHolderCif, policy.termMonths]).toEqual([`LIC-ONE-${stamp}`, `CIF-ONE-${stamp}`, 240]);
  });
});
