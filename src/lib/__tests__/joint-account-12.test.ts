// Change set #12 – joint account on proposals. Rows it creates are removed afterwards.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { holdersLabel } from "@/app/(app)/proposals/labels";
import { loadCustomer360 } from "@/lib/customer-360";
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

const { saveJointAccount, searchCustomers, issuePolicy } = await import("@/app/(app)/proposals/actions");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const users: Record<string, U> = {};
const started = new Date();
let first: { id: string; name: string; mobile: string; cifNo: string };
let other: { id: string; name: string; mobile: string; cifNo: string };
let proposalId = "";
const createdCustomers: string[] = [];

beforeAll(async () => {
  for (const username of ["arun", "admin"]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    users[username] = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
  }
  session.user = users.arun;
  const [a, b] = await prisma.customer.findMany({ where: { tenantId: users.arun.tenantId, ownerId: users.arun.id }, orderBy: { createdAt: "asc" }, take: 2 });
  first = a;
  other = b;
  const p = await prisma.proposal.create({
    data: {
      tenantId: users.arun.tenantId, proposalNo: `P-VT12-${started.getTime()}`, customerId: first.id, customerName: first.name, mobile: first.mobile,
      insurer: "Post Office", productType: "PoSsa", productName: "Vitest Joint Plan", premium: "5000", ownerId: users.arun.id, frequency: "Yearly", startDate: new Date(), termMonths: 60,
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
  await prisma.auditLog.deleteMany({ where: { entityId: proposalId } });
  await prisma.proposal.delete({ where: { id: proposalId } });
  await prisma.customerMobile.deleteMany({ where: { customerId: { in: createdCustomers } } });
  await prisma.customer.deleteMany({ where: { id: { in: createdCustomers } } });
  await prisma.$disconnect();
});

const save = (o: Record<string, string>) => saveJointAccount({ ok: false }, form({ proposalId, jointAccount: "on", secondHolderId: "", secondHolderName: "", secondHolderMobile: "", ...o }));

describe("Joint account on a proposal (#12)", () => {
  it("search finds customers by name, CIF or mobile, mobiles masked", async () => {
    const byCif = await searchCustomers(other.cifNo);
    expect(byCif.map((c) => c.id)).toContain(other.id);
    expect(byCif.every((c) => c.mobile.includes("x"))).toBe(true);
    expect(await searchCustomers("a")).toEqual([]);
  });

  it("second holder: an existing customer, never the first holder", async () => {
    expect((await save({ secondHolderId: first.id })).error).toMatch(/can't be the first holder/);
    expect(await save({ secondHolderId: other.id })).toEqual({ ok: true });
    const p = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId }, include: { secondHolder: true } });
    expect(p).toMatchObject({ jointAccount: true, secondHolderId: other.id });
    expect(holdersLabel(p)).toBe(`${first.name} + ${other.name} (joint)`);
  });

  it("a new person's mobile that belongs to a customer links that customer instead", async () => {
    const r = await save({ secondHolderName: "Someone", secondHolderMobile: other.mobile });
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining(other.cifNo) });
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } })).secondHolderId).toBe(other.id);
    expect((await save({ secondHolderName: "Someone", secondHolderMobile: first.mobile })).fieldErrors).toHaveProperty("secondHolderMobile");
  });

  it("off clears the second holder; logged", async () => {
    const logged = await prisma.auditLog.count({ where: { entityId: proposalId } });
    expect(await saveJointAccount({ ok: false }, form({ proposalId, jointAccount: "off" }))).toEqual({ ok: true });
    expect(await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } })).toMatchObject({ jointAccount: false, secondHolderId: null, secondHolderName: null });
    // a save that changes nothing writes no line (Save proposal saves the holders every time, 3 Nov 2026)
    expect(await prisma.auditLog.count({ where: { entityId: proposalId } })).toBe(logged + 1);
  });

  it("a single holder keeps the CIF given by the company", async () => {
    expect(await saveJointAccount({ ok: false }, form({ proposalId, jointAccount: "off", firstHolderCif: "lic-cif-9" }))).toEqual({ ok: true });
    expect(await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } })).toMatchObject({ jointAccount: false, firstHolderCif: "LIC-CIF-9", secondHolderCif: null });
  });

  it("a new second holder becomes a customer (with CIF) on issue; the policy shows on both customers' pages", async () => {
    expect((await save({ secondHolderName: "Vitest Second Holder", secondHolderMobile: "6000012121", firstHolderCif: "po123", secondHolderCif: "PO123" })).fieldErrors).toHaveProperty("secondHolderCif");
    expect(await save({ secondHolderName: "Vitest Second Holder", secondHolderMobile: "6000012121", firstHolderCif: "po-cif-111", secondHolderCif: "PO-CIF-222" })).toEqual({ ok: true });
    as("arun");
    expect((await issuePolicy({ ok: false }, form({ proposalId, policyNumber: `VT12-${started.getTime()}` }))).ok).toBe(true);
    const policy = await prisma.policy.findFirstOrThrow({ where: { proposalId }, include: { secondHolder: true } });
    expect(policy.customerId).toBe(first.id);
    expect(policy).toMatchObject({ firstHolderCif: "PO-CIF-111", secondHolderCif: "PO-CIF-222" });
    expect(policy.secondHolder).toMatchObject({ name: "Vitest Second Holder", mobile: "6000012121", cifNo: expect.stringMatching(/^CIF-\d+/) });
    createdCustomers.push(policy.secondHolderId!);

    const firstView = await loadCustomer360(users.admin, first.id);
    expect(firstView!.holdings.find((h) => h.id === policy.id)!.details).toContainEqual(["Joint account", expect.stringContaining("Vitest Second Holder")]);
    const secondView = await loadCustomer360(users.admin, policy.secondHolderId!);
    expect(secondView!.c.jointPolicies.map((p) => p.id)).toEqual([policy.id]);

    expect((await save({ secondHolderId: other.id })).error).toMatch(/already issued/);
  });
});

function as(u: string) {
  session.user = users[u];
}
