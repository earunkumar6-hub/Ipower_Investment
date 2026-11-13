// Change set phase 4b – receipts: bill groups, bill-group and combined receipts, advance bills, receipt tabs.
// Runs against the seeded database; every row it creates is removed afterwards.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { istToday, isoDate } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { payableDues } from "@/lib/dues";
import { receiptFilter } from "@/lib/lists";
import { setAccessOverrides } from "@/lib/permissions";
import { billEnd } from "@/lib/policies";

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

const { createBillGroup, addBillGroupMember, addBillGroupMembers, findPoliciesForGroup, removeBillGroupMember, createGroupReceipt, generateAdvanceBills } = await import("@/app/(app)/receipts/group-actions");
const { cancelPayment } = await import("@/app/(app)/receipts/actions");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const users: Record<string, U> = {};
const as = (u: string) => (session.user = users[u]);
const today = istToday();
const groups: string[] = [];
const payments: string[] = [];
const touched = ["RD 3105-235", "RD 3107-249", "RD 3109-263", "RD 3111-277", "RD 3115-305", "POL-480137"];
let before: Awaited<ReturnType<typeof load>>[] = [];
let bank = "";

const load = (policyNumber: string) => prisma.policy.findFirstOrThrow({ where: { policyNumber }, include: { renewals: true, product: { select: { invoiceRule: true } } } });
const payable = async (policyNumber: string) => {
  const p = await load(policyNumber);
  return { p, dues: payableDues({ ...p, billUntil: billEnd(p, p.product?.invoiceRule) }, p.renewals, today) };
};
/** UPI receipt fields for `dues` ({ policyNumber: count }), priced like the server does. */
async function receipt(kind: "Combined" | "BillGroup", dues: Record<string, number>, extra: Record<string, string> = {}) {
  const picks = [];
  let total = 0;
  for (const [policyNumber, count] of Object.entries(dues)) {
    const { p, dues: d } = await payable(policyNumber);
    picks.push({ policyId: p.id, count });
    total += d.slice(0, count).reduce((t, x) => t + Number(x.amount), 0);
  }
  return form({
    kind, billGroupId: "", dues: JSON.stringify(picks), amount: total.toFixed(2), mode: "UPI", reference: "UTR-VT-4B", intoAccountId: bank,
    bankName: "", netType: "", denominations: "", payerName: "Vitest Payer", payerMobile: "6000077788", poReceiptNo: "", notes: "", receiptDate: "", txnDate: "", ...extra,
  });
}

beforeAll(async () => {
  for (const username of ["arun", "divya", "admin"]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    users[username] = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
  }
  bank = (await prisma.account.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, type: "Bank", isDefault: true } })).id;
  before = await Promise.all(touched.map(load));
});

afterAll(async () => {
  const lines = await prisma.receipt.findMany({ where: { paymentId: { in: payments } }, select: { id: true } });
  const ids = lines.map((r) => r.id);
  await prisma.dayBookEntry.deleteMany({ where: { sourceId: { in: ids }, reversalOfId: { not: null } } });
  await prisma.dayBookEntry.deleteMany({ where: { sourceId: { in: ids } } });
  await prisma.commission.deleteMany({ where: { receiptId: { in: ids } } });
  await prisma.messageLog.deleteMany({ where: { relatedId: { in: [...ids, ...payments] } } });
  for (const p of before) {
    await prisma.renewalItem.updateMany({ where: { policyId: p.id }, data: { paidReceiptId: null } });
    await prisma.renewalItem.deleteMany({ where: { policyId: p.id, id: { notIn: p.renewals.map((r) => r.id) } } });
    for (const r of p.renewals) await prisma.renewalItem.update({ where: { id: r.id }, data: { status: r.status, paidOn: r.paidOn, paidReceiptId: r.paidReceiptId } });
  }
  await prisma.receipt.deleteMany({ where: { id: { in: ids } } });
  await prisma.payment.deleteMany({ where: { id: { in: payments } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: groups } }, { action: "AdvanceBills", createdAt: { gte: new Date(Date.now() - 3_600_000) } }] } });
  await prisma.billGroup.deleteMany({ where: { id: { in: groups } } });
  await prisma.$disconnect();
});

describe("Bill groups (#21)", () => {
  it("only Admin / Super Admin can create or change them", async () => {
    as("arun");
    await expect(createBillGroup({ ok: false }, form({ name: "Vitest family" }))).rejects.toThrow(/Not allowed/);
    await expect(addBillGroupMember({ ok: false }, form({ billGroupId: "x", policyNumber: "RD 3105-235" }))).rejects.toThrow(/Not allowed/);
  });

  it("a policy joins one group only; one-time deposits have no bills", async () => {
    as("admin");
    const g = await createBillGroup({ ok: false }, form({ name: "Vitest family", contactName: "Vitest Payer", contactMobile: "6000077788" }));
    expect(g.ok).toBe(true);
    groups.push(g.id!);
    expect((await createBillGroup({ ok: false }, form({ name: "vitest FAMILY" }))).ok).toBe(false);
    const other = await createBillGroup({ ok: false }, form({ name: "Vitest other" }));
    groups.push(other.id!);

    for (const n of ["RD 3105-235", "RD 3107-249"]) expect(await addBillGroupMember({ ok: false }, form({ billGroupId: g.id!, policyNumber: n }))).toEqual({ ok: true });
    expect((await addBillGroupMember({ ok: false }, form({ billGroupId: other.id!, policyNumber: "RD 3105-235" }))).error).toMatch(/Already in bill group Vitest family/);
    const oneTime = await prisma.policy.findFirstOrThrow({ where: { frequency: "OneTime", status: "Active" } });
    expect((await addBillGroupMember({ ok: false }, form({ billGroupId: other.id!, policyNumber: oneTime.policyNumber }))).error).toMatch(/one-time/);

    expect(await addBillGroupMember({ ok: false }, form({ billGroupId: other.id!, policyNumber: "RD 3115-305" }))).toEqual({ ok: true });
    const m = await prisma.billGroupMember.findFirstOrThrow({ where: { billGroupId: other.id!, policy: { policyNumber: "RD 3115-305" } } });
    expect((await removeBillGroupMember({ ok: false }, form({ memberId: m.id }))).ok).toBe(true);
    expect(await prisma.auditLog.count({ where: { entityId: g.id! } })).toBe(3);
  });

  it("find policies to add: by name or part of the number; ticked ones are added together with the same rules", async () => {
    as("arun");
    await expect(findPoliciesForGroup(groups[1], "3115")).rejects.toThrow(/Not allowed/);
    await expect(addBillGroupMembers(groups[1], ["x"])).rejects.toThrow(/Not allowed/);
    as("admin");
    expect(await findPoliciesForGroup(groups[1], "3")).toEqual({ error: "Type at least 2 letters or digits" });

    const found = await findPoliciesForGroup(groups[1], "3115");
    if ("error" in found) throw new Error(found.error);
    const rd = found.hits.find((h) => h.policyNumber === "RD 3115-305")!;
    expect(rd).toMatchObject({ problem: null, payMode: "Monthly" });
    const byName = await findPoliciesForGroup(groups[1], (await prisma.customer.findFirstOrThrow({ where: { policies: { some: { id: rd.id } } } })).name);
    expect("hits" in byName && byName.hits.some((h) => h.id === rd.id)).toBe(true);
    const taken = await findPoliciesForGroup(groups[1], "3105-235");
    expect("hits" in taken && taken.hits[0].problem).toBe("Already in bill group Vitest family");

    expect((await addBillGroupMembers(groups[1], [rd.id, ("hits" in taken && taken.hits[0].id) || ""])).error).toMatch(/Already in bill group Vitest family/);
    expect(await prisma.billGroupMember.count({ where: { billGroupId: groups[1] } })).toBe(0); // all or none
    expect(await addBillGroupMembers(groups[1], [rd.id])).toMatchObject({ ok: true, message: "1 policy added to Vitest other" });
    const again = await findPoliciesForGroup(groups[1], "3115");
    expect("hits" in again && again.hits.find((h) => h.id === rd.id)?.problem).toBe("Already in this group");
  });

  it("one receipt pays every member's bill, each under its own customer, with the same PAY- number", async () => {
    as("admin");
    const outsider = await receipt("BillGroup", { "RD 3105-235": 1, "RD 3109-263": 1 }, { billGroupId: groups[0] });
    expect((await createGroupReceipt({ ok: false }, outsider)).error).toMatch(/not in this bill group/);

    const r = await createGroupReceipt({ ok: false }, await receipt("BillGroup", { "RD 3105-235": 2, "RD 3107-249": 1 }, { billGroupId: groups[0] }));
    expect(r).toMatchObject({ ok: true, href: expect.stringMatching(/^\/payments\//) });
    payments.push(r.id!);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: r.id }, include: { receipts: { include: { policy: true } } } });
    expect(p).toMatchObject({ kind: "BillGroup", billGroupId: groups[0], customerId: null, payerName: "Vitest Payer" });
    expect(p.receipts).toHaveLength(3);
    expect(new Set(p.receipts.map((x) => x.customerId)).size).toBe(2);
    expect(p.receipts.every((x) => x.accountId === bank && x.rdStatus === "Collected")).toBe(true);
    const items = await prisma.renewalItem.findMany({ where: { paidReceiptId: { in: p.receipts.map((x) => x.id) } } });
    expect(items.every((i) => i.status === "Paid")).toBe(true);
    expect(items).toHaveLength(3);
  });
});

describe("Combined receipt (#5)", () => {
  it("needs the payer and the right amount; bills not yet raised can't be ticked", async () => {
    as("admin");
    expect((await createGroupReceipt({ ok: false }, await receipt("Combined", { "RD 3109-263": 1 }, { payerName: "" }))).fieldErrors).toHaveProperty("payerName");
    expect((await createGroupReceipt({ ok: false }, await receipt("Combined", { "RD 3109-263": 1 }, { amount: "1" }))).error).toMatch(/Amount must be/);
    const open = (await payable("RD 3109-263")).dues.filter((d) => d.itemId).length;
    expect((await createGroupReceipt({ ok: false }, await receipt("Combined", { "RD 3109-263": open + 1 }))).error).toMatch(/open bill/);
  });

  it("with 'work on every customer' switched off a User can't tick another user's customer's bill; an unknown policy is refused", async () => {
    as("arun");
    setAccessOverrides({ User: { "Records.SeeAll": false } });
    try {
      expect((await createGroupReceipt({ ok: false }, await receipt("Combined", { "RD 3109-263": 1, "POL-480137": 1 }))).error).toMatch(/another user's customer/);
    } finally {
      setAccessOverrides({});
    }
    const fake = form({ ...Object.fromEntries(await receipt("Combined", { "RD 3109-263": 1 })), dues: JSON.stringify([{ policyId: "not-a-policy", count: 1 }]) } as Record<string, string>);
    expect((await createGroupReceipt({ ok: false }, fake)).ok).toBe(false);
  });

  it("bills of several customers → one receipt; it shows on the Combined tab, not under Customer receipts; cancel undoes every line", async () => {
    as("arun");
    const r = await createGroupReceipt({ ok: false }, await receipt("Combined", { "RD 3109-263": 1, "RD 3111-277": 2 }, { poReceiptNo: "PO-VT-77" }));
    expect(r.ok).toBe(true);
    payments.push(r.id!);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: r.id }, include: { receipts: true } });
    expect(p).toMatchObject({ kind: "Combined", poReceiptNo: "PO-VT-77", createdById: users.arun.id });

    const f = receiptFilter(users.arun, { q: "Vitest Payer" });
    expect((await prisma.payment.findMany({ where: f.paymentWhere("Combined") })).map((x) => x.id)).toContain(p.id);
    expect(await prisma.payment.count({ where: { id: p.id, ...f.paymentWhere("BillGroup") } })).toBe(0);
    const all = receiptFilter(users.arun, {});
    expect(await prisma.receipt.count({ where: { AND: [all.receiptWhere, { paymentId: p.id }] } })).toBe(0);
    // Every role sees every receipt by default (#10); not once 'work on every customer' is switched off for Users.
    expect(await prisma.payment.count({ where: { id: p.id, ...receiptFilter(users.divya, {}).paymentWhere("Combined") } })).toBe(1);
    setAccessOverrides({ User: { "Records.SeeAll": false } });
    expect(await prisma.payment.count({ where: { id: p.id, ...receiptFilter(users.divya, {}).paymentWhere("Combined") } })).toBe(0);
    setAccessOverrides({});

    as("admin");
    expect(await cancelPayment({ ok: false }, form({ paymentId: p.id, reason: "Vitest undo" }))).toEqual({ ok: true });
    const lines = await prisma.receipt.findMany({ where: { paymentId: p.id } });
    expect(lines.every((x) => x.status === "Cancelled")).toBe(true);
    expect(await prisma.renewalItem.count({ where: { paidReceiptId: { in: lines.map((x) => x.id) } } })).toBe(0);
    expect(await prisma.dayBookEntry.count({ where: { sourceId: { in: lines.map((x) => x.id) }, reversalOfId: { not: null } } })).toBe(3);
  });
});

describe("Instalments by date (#23): advance bills", () => {
  it("raises the advance instalments up to To as Due bills, never twice and never past the bill rule", async () => {
    as("admin");
    const { p, dues } = await payable("RD 3115-305");
    const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 6, 28));
    const expected = dues.filter((d) => !d.itemId && d.dueDate <= to);
    const r = await generateAdvanceBills({ ok: false }, form({ customerId: p.customerId, to: isoDate(to) }));
    expect(r.ok).toBe(true);
    const raised = await prisma.renewalItem.findMany({ where: { policyId: p.id, id: { notIn: p.renewals.map((x) => x.id) } } });
    expect(raised.length).toBeGreaterThanOrEqual(expected.length);
    expect(raised.every((i) => i.status === "Due" && i.dueDate <= to && /^IP-\d{2,}$/.test(i.billNo))).toBe(true);
    const end = billEnd(p, p.product?.invoiceRule);
    if (end) expect(raised.every((i) => i.dueDate < end)).toBe(true);

    const again = await generateAdvanceBills({ ok: false }, form({ customerId: p.customerId, to: isoDate(to) }));
    expect(again.message).toMatch(/No advance bills/);
    expect(await prisma.renewalItem.count({ where: { policyId: p.id } })).toBe(p.renewals.length + raised.length);
  });

  it("with 'work on every customer' switched off a User can't raise bills on another user's customer", async () => {
    as("divya");
    const { p } = await payable("RD 3115-305");
    setAccessOverrides({ User: { "Records.SeeAll": false } });
    try {
      expect((await generateAdvanceBills({ ok: false }, form({ customerId: p.customerId, to: isoDate(today) }))).error).toMatch(/another user's customer/);
    } finally {
      setAccessOverrides({});
    }
  });
});
