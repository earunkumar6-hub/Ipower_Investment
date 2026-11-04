// Change set #1, #13, #28 – consent tick, Aadhaar / PAN / company CIF unique, duplicate details for the pop-up.
// Rows it creates are removed and the customers it touches are put back afterwards.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decryptJson, fingerprint } from "@/lib/crypto";
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

const { saveKyc, saveJointAccount, issuePolicy } = await import("@/app/(app)/proposals/actions");
const { saveCustomerIdentity } = await import("@/app/(app)/customers/actions");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const users: Record<string, U> = {};
const started = new Date();
const AADHAAR_B = "987654321012", PAN_B = "BBBBB1234B", AADHAAR_A = "555566667777";
let a: { id: string; name: string; mobile: string }, b: { id: string; name: string; mobile: string; cifNo: string };
let proposalId = "";
let bPolicy: { id: string; partner: string; firstHolderCif: string | null };
const blank = { aadhaarEnc: null, aadhaarHash: null, aadhaarLast4: null, panEnc: null, panHash: null, panMasked: null, consentAt: null, consentById: null };

beforeAll(async () => {
  for (const username of ["arun", "admin"]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    users[username] = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
  }
  session.user = users.admin;
  const withPolicies = await prisma.customer.findMany({ where: { tenantId: users.admin.tenantId, policies: { some: {} } }, orderBy: { createdAt: "asc" }, take: 2, include: { policies: true } });
  [a, b] = withPolicies;
  bPolicy = withPolicies[1].policies[0];
  await prisma.customer.updateMany({ where: { id: { in: [a.id, b.id] } }, data: blank });
  const p = await prisma.proposal.create({
    data: {
      tenantId: users.admin.tenantId, proposalNo: `P-VT13-${started.getTime()}`, customerId: a.id, customerName: a.name, mobile: a.mobile,
      insurer: bPolicy.partner, productName: "Vitest identity plan", premium: "1000", ownerId: users.arun.id, frequency: "Yearly", startDate: new Date(), termMonths: 24, sumInsured: "100000", premiumPayingTermMonths: 24,
    },
  });
  proposalId = p.id;
});

afterAll(async () => {
  const policy = await prisma.policy.findFirst({ where: { proposalId } });
  if (policy) {
    await prisma.renewalItem.deleteMany({ where: { policyId: policy.id } });
    await prisma.policy.delete({ where: { id: policy.id } });
  }
  await prisma.policy.update({ where: { id: bPolicy.id }, data: { firstHolderCif: bPolicy.firstHolderCif } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [proposalId, a.id, b.id] }, createdAt: { gte: started } } });
  await prisma.proposal.delete({ where: { id: proposalId } });
  await prisma.customer.updateMany({ where: { id: { in: [a.id, b.id] } }, data: blank });
  await prisma.$disconnect();
});

describe("Consent tick (#1)", () => {
  it("Aadhaar / PAN can't be saved before the tick; the tick records who and when", async () => {
    const r = await saveCustomerIdentity({ ok: false }, form({ customerId: b.id, consent: "", aadhaar: AADHAAR_B, pan: "" }));
    expect(r.fieldErrors).toHaveProperty("consent");
    expect(await saveCustomerIdentity({ ok: false }, form({ customerId: b.id, consent: "on", aadhaar: AADHAAR_B, pan: PAN_B }))).toEqual({ ok: true });
    const saved = await prisma.customer.findUniqueOrThrow({ where: { id: b.id } });
    expect(saved).toMatchObject({ aadhaarLast4: "1012", panMasked: "BBBxxxxx4B", consentById: users.admin.id });
    expect(saved.consentAt).not.toBeNull();
    // Stored encrypted (full value recoverable only with the key), fingerprint for matching, never in the log in clear.
    expect(decryptJson(saved.aadhaarEnc!)).toBe(AADHAAR_B);
    expect(saved.aadhaarHash).toBe(fingerprint("aadhaar", AADHAAR_B));
    const log = await prisma.auditLog.findMany({ where: { entityId: b.id, createdAt: { gte: started } } });
    expect(log.some((l) => l.summary.includes(AADHAAR_B) || l.summary.includes(PAN_B))).toBe(false);
  });
});

describe("Aadhaar / PAN unique (#13) with the existing customer's details (#28)", () => {
  it("a proposal for someone else can't take another customer's Aadhaar or PAN", async () => {
    const tick = await saveKyc({ ok: false }, form({ proposalId, consent: "", aadhaar: "", pan: "" }));
    expect(tick.fieldErrors).toHaveProperty("consent");
    const r = await saveKyc({ ok: false }, form({ proposalId, consent: "on", aadhaar: AADHAAR_B, pan: PAN_B }));
    expect(r.ok).toBe(false);
    expect(r.duplicate).toMatchObject({ customerId: b.id, cifNo: b.cifNo, name: b.name, matchedOn: ["Aadhaar", "PAN"] });
    expect(r.duplicate!.mobile).toMatch(/x/);
    expect(r.duplicate!.products.length).toBeGreaterThan(0);
    expect((await saveKyc({ ok: false }, form({ proposalId, consent: "on", aadhaar: "", pan: PAN_B }))).duplicate?.matchedOn).toEqual(["PAN"]);
    expect(await saveKyc({ ok: false }, form({ proposalId, consent: "on", aadhaar: AADHAAR_A, pan: "" }))).toEqual({ ok: true });
  });

  it("the customer page refuses it too; a customer's own number is not a duplicate", async () => {
    expect((await saveCustomerIdentity({ ok: false }, form({ customerId: a.id, consent: "on", aadhaar: AADHAAR_B, pan: "" }))).duplicate?.customerId).toBe(b.id);
    expect(await saveCustomerIdentity({ ok: false }, form({ customerId: b.id, consent: "", aadhaar: AADHAAR_B, pan: "" }))).toEqual({ ok: true });
  });

  it("the database itself refuses a second customer with the same fingerprint", async () => {
    await expect(prisma.customer.update({ where: { id: a.id }, data: { aadhaarHash: fingerprint("aadhaar", AADHAAR_B) } })).rejects.toThrow(/Unique constraint/);
  });

  it("issuing copies the encrypted numbers and the consent to the customer", async () => {
    expect((await issuePolicy({ ok: false }, form({ proposalId, policyNumber: `VT13-${started.getTime()}` }))).ok).toBe(true);
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: a.id } });
    expect(c).toMatchObject({ aadhaarLast4: "7777", aadhaarHash: fingerprint("aadhaar", AADHAAR_A) });
    expect(c.consentAt).not.toBeNull();
  });
});

describe("Company CIF unique within a company (#13)", () => {
  it("a CIF held by another customer at the same company is refused; another company's is fine", async () => {
    await prisma.policy.update({ where: { id: bPolicy.id }, data: { firstHolderCif: "VT13-CIF-1" } });
    const fresh = await prisma.proposal.create({
      data: {
        tenantId: users.admin.tenantId, proposalNo: `P-VT13b-${started.getTime()}`, customerId: a.id, customerName: a.name, mobile: a.mobile,
        insurer: bPolicy.partner, productType: "PoTd", productName: "Vitest CIF plan", premium: "1000", ownerId: users.arun.id, // CIFs: post office only
      },
    });
    try {
      const r = await saveJointAccount({ ok: false }, form({ proposalId: fresh.id, jointAccount: "off", firstHolderCif: "vt13-cif-1" }));
      expect(r).toMatchObject({ ok: false, duplicate: { customerId: b.id, matchedOn: [`${bPolicy.partner} CIF`] } });
      await prisma.proposal.update({ where: { id: fresh.id }, data: { insurer: `${bPolicy.partner} (other)` } });
      expect((await saveJointAccount({ ok: false }, form({ proposalId: fresh.id, jointAccount: "off", firstHolderCif: "VT13-CIF-1" }))).ok).toBe(true);
    } finally {
      await prisma.auditLog.deleteMany({ where: { entityId: fresh.id } });
      await prisma.proposal.delete({ where: { id: fresh.id } });
    }
  });
});
