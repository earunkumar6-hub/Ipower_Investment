// Change set #1, #28 – consent tick, Aadhaar / PAN stored and shown in full and allowed to repeat (owner, 24 Nov 2026),
// company CIF unique with the duplicate details for the pop-up.
// Rows it creates are removed and the customers it touches are put back afterwards.
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

const { saveKyc, saveJointAccount, issuePolicy } = await import("@/app/(app)/proposals/actions");
const { saveCustomerIdentity } = await import("@/app/(app)/customers/actions");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const users: Record<string, U> = {};
const started = new Date();
const AADHAAR_B = "987654321012", PAN_B = "BBBBB1234B", AADHAAR_A = "555566667771";
let a: { id: string; name: string; mobile: string }, b: { id: string; name: string; mobile: string; cifNo: string };
let proposalId = "";
let bPolicy: { id: string; partner: string; firstHolderCif: string | null };
const blank = { aadhaarNo: null, panNo: null, aadhaarEnc: null, aadhaarHash: null, aadhaarLast4: null, panEnc: null, panHash: null, panMasked: null, consentAt: null, consentById: null };

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
    // Stored in full – no encryption, no fingerprint – and written in full to the change log.
    expect(saved).toMatchObject({ aadhaarNo: AADHAAR_B, panNo: PAN_B, aadhaarEnc: null, aadhaarHash: null, panEnc: null, panHash: null });
    const log = await prisma.auditLog.findMany({ where: { entityId: b.id, createdAt: { gte: started } } });
    expect(log.some((l) => l.summary.includes("9876 5432 1012") && l.summary.includes(PAN_B))).toBe(true);
  });
});

describe("Aadhaar / PAN may repeat across customers (owner, 24 Nov 2026)", () => {
  it("a proposal can take the number another customer already has", async () => {
    const tick = await saveKyc({ ok: false }, form({ proposalId, consent: "", aadhaar: "", pan: "" }));
    expect(tick.fieldErrors).toHaveProperty("consent");
    expect(await saveKyc({ ok: false }, form({ proposalId, consent: "on", aadhaar: AADHAAR_B, pan: PAN_B }))).toEqual({ ok: true });
    expect(await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } })).toMatchObject({ aadhaarNo: AADHAAR_B, panNo: PAN_B });
    expect(await saveKyc({ ok: false }, form({ proposalId, consent: "on", aadhaar: AADHAAR_A, pan: "" }))).toEqual({ ok: true });
    expect(await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } })).toMatchObject({ aadhaarNo: AADHAAR_A, aadhaarLast4: "7771" });
  });

  it("the customer page takes it too, and the database has no unique rule on it", async () => {
    expect(await saveCustomerIdentity({ ok: false }, form({ customerId: a.id, consent: "on", aadhaar: AADHAAR_B, pan: PAN_B }))).toEqual({ ok: true });
    expect(await prisma.customer.count({ where: { id: { in: [a.id, b.id] }, aadhaarNo: AADHAAR_B, panNo: PAN_B } })).toBe(2);
  });

  it("issuing refuses a different number already on the customer, else copies the numbers and the consent", async () => {
    // Customer a still holds B's numbers from the test above; the proposal has A's.
    const refused = await issuePolicy({ ok: false }, form({ proposalId, policyNumber: `VT13-${started.getTime()}` }));
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/Aadhaar on this proposal doesn't match .*9876 5432 1012/);
    await prisma.customer.update({ where: { id: a.id }, data: blank });
    expect((await issuePolicy({ ok: false }, form({ proposalId, policyNumber: `VT13-${started.getTime()}` }))).ok).toBe(true);
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: a.id } });
    expect(c).toMatchObject({ aadhaarNo: AADHAAR_A, aadhaarLast4: "7771", panNo: PAN_B });
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
