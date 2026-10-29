// Phase 3 (Oct 2026 round 2): per-product decision on quotations, not accepted / delete, proposal policy details,
// "Add product directly" (catalogue rules, encrypted bank details, rate at opening), attachments.
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

const { createProposalsFromSelected, markNotAccepted, deleteQuotation } = await import("@/app/(app)/quotations/actions");
const { savePolicyDetails, issuePolicy, saveKyc } = await import("@/app/(app)/proposals/actions");
const { addProductDirect } = await import("@/app/(app)/customers/actions");
const { uploadAttachment, removeAttachment } = await import("@/app/(app)/attachments/actions");
const { decryptJson } = await import("@/lib/crypto");
const { deleteStoredFile } = await import("@/lib/attachments");

const started = new Date();
const today = isoDate(istToday());
const users = {} as Record<"arun" | "divya" | "admin", U>;
const as = (u: U) => { session.user = u; };
const form = (o: Record<string, string | Blob>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};
let rajesh = { id: "", ownerId: "" };
let quote = { id: "", itemIds: [] as string[], leadId: "" as string | null };

beforeAll(async () => {
  for (const k of ["arun", "divya", "admin"] as const) {
    const u = await prisma.user.findFirstOrThrow({ where: { username: k } });
    users[k] = { id: u.id, name: u.name, username: k, role: u.role, tenantId: u.tenantId };
  }
  rajesh = await prisma.customer.findFirstOrThrow({ where: { name: "Rajesh Kumar" }, select: { id: true, ownerId: true } });
  // A fresh quotation for Rajesh (Arun's customer) with two catalogue plans.
  const q = await prisma.quotation.create({
    data: {
      tenantId: users.arun.tenantId, quoteNo: `Q-T${Date.now() % 100000}`, customerId: rajesh.id, customerName: "Rajesh Kumar", mobile: "9876500000",
      validUpto: new Date(Date.now() + 10 * 86_400_000), subtotal: "30000.00", total: "30000.00", ownerId: rajesh.ownerId,
      items: {
        create: [
          { category: "Health", insurer: "Care Health", productName: "Care Supreme", premium: "20000.00", total: "20000.00", payMode: "Yearly" },
          { category: "Life", insurer: "LIC", productName: "Jeevan Anand", premium: "10000.00", total: "10000.00", payMode: "HalfYearly" },
        ],
      },
    },
    include: { items: true },
  });
  quote = { id: q.id, itemIds: q.items.map((i) => i.id), leadId: q.leadId };
});

afterAll(async () => {
  const proposals = await prisma.proposal.findMany({ where: { createdAt: { gte: started } }, select: { id: true } });
  const pids = proposals.map((p) => p.id);
  const policies = await prisma.policy.findMany({ where: { OR: [{ proposalId: { in: pids } }, { createdAt: { gte: started } }] }, select: { id: true } });
  const polIds = policies.map((p) => p.id);
  await prisma.renewalItem.deleteMany({ where: { policyId: { in: polIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: polIds } } });
  await prisma.consent.deleteMany({ where: { proposalId: { in: pids } } });
  await prisma.messageLog.deleteMany({ where: { relatedId: { in: pids } } });
  await prisma.proposal.deleteMany({ where: { id: { in: pids } } });
  await prisma.quotation.deleteMany({ where: { createdAt: { gte: started } } });
  const files = await prisma.attachment.findMany({ where: { createdAt: { gte: started } } });
  for (const f of files) await deleteStoredFile(f.storedName);
  await prisma.attachment.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.$disconnect();
});

describe("Quotation decision", () => {
  it("the ticked product becomes a proposal linked to the catalogue; the other is Not accepted", async () => {
    as(users.divya);
    expect((await createProposalsFromSelected(quote.id, [quote.itemIds[0]])).error).toMatch(/another user/);
    as(users.arun);
    expect((await createProposalsFromSelected(quote.id, [])).error).toMatch(/Tick/);
    const r = await createProposalsFromSelected(quote.id, [quote.itemIds[0]]);
    expect(r.ok).toBe(true);
    const q = await prisma.quotation.findUniqueOrThrow({ where: { id: quote.id }, include: { items: { include: { proposal: { include: { product: true } } } } } });
    expect(q.status).toBe("Accepted");
    const [care, lic] = quote.itemIds.map((id) => q.items.find((i) => i.id === id)!);
    expect([care.decision, lic.decision]).toEqual(["Selected", "NotAccepted"]);
    expect(care.proposal?.product?.name).toBe("Care Supreme");
    expect(care.proposal?.frequency).toBe("Yearly");
    // the declined product can still be confirmed later
    expect((await createProposalsFromSelected(quote.id, [quote.itemIds[1]])).ok).toBe(true);
    const later = await prisma.quotationItem.findUniqueOrThrow({ where: { id: quote.itemIds[1] }, include: { proposal: true } });
    expect([later.decision, later.proposal?.frequency]).toEqual(["Selected", "HalfYearly"]);
  });

  it("with proposals the quotation can't be deleted or marked not accepted", async () => {
    as(users.arun);
    expect((await deleteQuotation(quote.id, "Entered twice")).error).toMatch(/can't be deleted/);
    expect((await markNotAccepted(quote.id, "Too costly")).error).toMatch(/already made/);
  });

  it("a quotation without proposals: Not accepted needs a reason; delete hides it and is logged", async () => {
    const q = await prisma.quotation.create({
      data: {
        tenantId: users.arun.tenantId, quoteNo: `Q-D${Date.now() % 100000}`, customerId: rajesh.id, customerName: "Rajesh Kumar", mobile: "9876500000",
        validUpto: new Date(Date.now() + 86_400_000), subtotal: "1000.00", total: "1000.00", ownerId: rajesh.ownerId,
        items: { create: { category: "Health", insurer: "Star Health", productName: "Comprehensive", premium: "1000.00", total: "1000.00" } },
      },
    });
    as(users.arun);
    expect((await markNotAccepted(q.id, "")).error).toMatch(/reason/);
    expect((await markNotAccepted(q.id, "Premium too high")).ok).toBe(true);
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("NotAccepted");
    expect((await deleteQuotation(q.id, "Customer moved away")).ok).toBe(true);
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } })).deletedAt).not.toBeNull();
    expect((await prisma.auditLog.findFirstOrThrow({ where: { entityId: q.id, action: "Deleted" } })).reason).toBe("Customer moved away");
    expect((await deleteQuotation(q.id, "again")).error).toMatch(/not found/i);
  });
});

describe("Proposal policy details", () => {
  it("no OTP consent: a quotation proposal only needs its policy details; Aadhaar / PAN are optional", async () => {
    as(users.arun);
    const p = await prisma.proposal.findFirstOrThrow({ where: { quotationItemId: quote.itemIds[0] } });
    expect(p.status).toBe("Draft");
    expect(await prisma.consent.count({ where: { proposalId: p.id } })).toBe(0);
    expect(await prisma.messageLog.count({ where: { relatedId: p.id, template: "kyc_consent_link" } })).toBe(0);
    // the pay mode came from the quotation; the start date is still missing
    expect((await issuePolicy({ ok: false }, form({ proposalId: p.id, policyNumber: "CARE-T-1" }))).error).toMatch(/pay mode and start date/);
    expect((await savePolicyDetails({ ok: false }, form({ proposalId: p.id, frequency: "Yearly", term: "1", premiumPayingTerm: "2", startDate: today }))).error).toMatch(/longer than the term/);
    expect((await savePolicyDetails({ ok: false }, form({ proposalId: p.id, frequency: "Yearly", term: "3", premiumPayingTerm: "", startDate: today }))).ok).toBe(true);
    // Aadhaar / PAN: only after "Customer consent taken" (#1); then any time, one without the other
    expect((await saveKyc({ ok: false }, form({ proposalId: p.id, pan: "", aadhaar: "1234 5678 9012" }))).fieldErrors).toHaveProperty("consent");
    expect((await saveKyc({ ok: false }, form({ proposalId: p.id, consent: "on", pan: "", aadhaar: "1234 5678 9012" }))).ok).toBe(true);
    expect((await saveKyc({ ok: false }, form({ proposalId: p.id, pan: "", aadhaar: "" }))).error).toMatch(/both are optional/);
    // Yearly × 3 years → renewals in years 2 and 3 (the 12-month horizon stores the first); no PAN needed
    expect((await issuePolicy({ ok: false }, form({ proposalId: p.id, policyNumber: `CARE-T-${Date.now() % 100000}` }))).ok).toBe(true);
    const policy = await prisma.policy.findFirstOrThrow({ where: { proposalId: p.id }, include: { renewals: true, customer: true } });
    expect([policy.frequency, policy.termMonths, policy.productId !== null, policy.renewals.length, policy.customer.aadhaarLast4]).toEqual(["Yearly", 36, true, 1, "9012"]);
  });
});

describe("Add product directly", () => {
  const td = async () => prisma.product.findFirstOrThrow({ where: { name: "Post Office TD" }, include: { schemes: true, customFields: true } });

  it("checks the product's rules: scheme, pay mode, custom fields, bank details", async () => {
    const p = await td();
    const five = p.schemes.find((s) => s.name === "TD 5 years")!;
    const branch = p.customFields.find((f) => f.label === "Post office branch")!;
    const base = { customerId: rajesh.id, productId: p.id, schemeId: five.id, amount: "100000", startDate: today, frequency: "OneTime" };
    as(users.divya);
    expect((await addProductDirect({ ok: false }, form(base))).error).toMatch(/another user/);
    as(users.arun);
    expect((await addProductDirect({ ok: false }, form({ ...base, schemeId: "" }))).fieldErrors).toHaveProperty("schemeId");
    expect((await addProductDirect({ ok: false }, form({ ...base, frequency: "Monthly" }))).error).toMatch(/one-time/i);
    expect((await addProductDirect({ ok: false }, form(base))).fieldErrors).toHaveProperty(`cf_${branch.id}`);
    expect((await addProductDirect({ ok: false }, form({ ...base, [`cf_${branch.id}`]: "Nowhere" }))).error).toMatch(/from the list/);
    const withBranch = { ...base, [`cf_${branch.id}`]: "Mylapore" };
    expect((await addProductDirect({ ok: false }, form(withBranch))).fieldErrors).toHaveProperty("bank_holder");
    const bank = { bank_holder: "Rajesh Kumar", bank_bank: "SBI", bank_branch: "Mylapore", bank_ifsc: "SBIN0001234", bank_accountNo: "12345" };
    expect((await addProductDirect({ ok: false }, form({ ...withBranch, ...bank }))).error).toMatch(/6–18 digits/);
  });

  it("blank policy number → proposal; its policy keeps the opening rate, encrypted bank details and no bills", async () => {
    const p = await td();
    const five = p.schemes.find((s) => s.name === "TD 5 years")!;
    const branch = p.customFields.find((f) => f.label === "Post office branch")!;
    as(users.arun);
    const r = await addProductDirect({ ok: false }, form({
      customerId: rajesh.id, productId: p.id, schemeId: five.id, amount: "100000", startDate: today, frequency: "OneTime", nominee: "Priya Rajesh",
      [`cf_${branch.id}`]: "Mylapore", bank_holder: "Rajesh Kumar", bank_bank: "SBI", bank_branch: "Mylapore", bank_ifsc: "sbin0001234", bank_accountNo: "123456789012",
    }));
    expect(r.ok).toBe(true);
    const prop = await prisma.proposal.findUniqueOrThrow({ where: { id: r.id } });
    expect([prop.quotationId, prop.status, prop.productName, prop.termMonths, prop.rateAtOpen?.toFixed(2)]).toEqual([null, "Draft", "TD 5 years", 60, "7.50"]);
    expect(prop.bankDetailsEnc).not.toContain("123456789012");
    expect(decryptJson<Record<string, string>>(prop.bankDetailsEnc!)).toMatchObject({ ifsc: "SBIN0001234", accountNo: "123456789012" });

    const no = `TD-T-${Date.now() % 100000}`;
    expect((await issuePolicy({ ok: false }, form({ proposalId: prop.id, policyNumber: no }))).ok).toBe(true);
    const policy = await prisma.policy.findUniqueOrThrow({ where: { tenantId_policyNumber: { tenantId: users.arun.tenantId, policyNumber: no } }, include: { renewals: true } });
    expect([policy.status, policy.productType, policy.rateAtOpen?.toFixed(2), policy.nominee, policy.renewals.length]).toEqual(["Active", "PoTd", "7.50", "Priya Rajesh", 0]);
    expect(policy.customValues).toEqual({ "Post office branch": "Mylapore" });
  });

  it("with a policy number it is Active at once; RD gets its monthly bills", async () => {
    const rd = await prisma.product.findFirstOrThrow({ where: { name: "Post Office RD" }, include: { schemes: true, customFields: true } });
    as(users.arun);
    const no = `RD T${Date.now() % 100000}`;
    const r = await addProductDirect({ ok: false }, form({
      customerId: rajesh.id, productId: rd.id, schemeId: rd.schemes[0].id, policyNumber: no, amount: "1000", startDate: today, frequency: "Monthly",
      [`cf_${rd.customFields[0].id}`]: "Chennai GPO",
    }));
    expect(r.ok).toBe(true);
    const policy = await prisma.policy.findUniqueOrThrow({ where: { id: r.id }, include: { renewals: true } });
    expect([policy.status, policy.rateAtOpen?.toFixed(2), policy.renewals.length]).toEqual(["Active", "6.70", 12]);
    expect((await addProductDirect({ ok: false }, form({
      customerId: rajesh.id, productId: rd.id, schemeId: rd.schemes[0].id, policyNumber: no, amount: "1000", startDate: today, frequency: "Monthly",
      [`cf_${rd.customFields[0].id}`]: "Chennai GPO",
    }))).fieldErrors).toHaveProperty("policyNumber");
  });
});

describe("Attachments", () => {
  it("only people who can see the record attach files; uploader or Admin removes; removal is logged", async () => {
    const png = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "pan.png", { type: "image/png" });
    as(users.divya);
    expect((await uploadAttachment({ ok: false }, form({ ownerType: "Customer", ownerId: rajesh.id, kind: "PAN", file: png }))).error).toMatch(/another user/);
    as(users.arun);
    expect((await uploadAttachment({ ok: false }, form({ ownerType: "Customer", ownerId: rajesh.id, kind: "Payslip", file: png }))).error).toMatch(/what the file is/);
    expect((await uploadAttachment({ ok: false }, form({ ownerType: "Customer", ownerId: rajesh.id, kind: "PAN", file: new File(["x"], "a.exe", { type: "application/x-msdownload" }) }))).error).toMatch(/PDF, JPG/);
    // Aadhaar / PAN copies: a JPG of 50 KB or smaller only (owner, 26 Oct 2026); other kinds keep PNG / PDF up to 5 MB.
    const jpg = (bytes: number, name = "pan.jpg") => new File([new Uint8Array(bytes)], name, { type: "image/jpeg" });
    expect((await uploadAttachment({ ok: false }, form({ ownerType: "Customer", ownerId: rajesh.id, kind: "PAN", file: png }))).error).toMatch(/JPG photo of 50 KB/);
    expect((await uploadAttachment({ ok: false }, form({ ownerType: "Customer", ownerId: rajesh.id, kind: "Aadhaar", file: jpg(50 * 1024 + 1) }))).error).toMatch(/JPG photo of 50 KB/);
    expect((await uploadAttachment({ ok: false }, form({ ownerType: "Customer", ownerId: rajesh.id, kind: "PAN", file: jpg(50 * 1024) }))).ok).toBe(true);
    const a = await prisma.attachment.findFirstOrThrow({ where: { ownerId: rajesh.id, createdAt: { gte: started } } });
    expect([a.kind, a.fileName, a.uploadedById]).toEqual(["PAN", "pan.jpg", users.arun.id]);
    as(users.admin);
    expect((await removeAttachment(a.id)).ok).toBe(true);
    expect(await prisma.attachment.count({ where: { id: a.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: rajesh.id, action: "File removed" } })).toBe(1);
  });
});

