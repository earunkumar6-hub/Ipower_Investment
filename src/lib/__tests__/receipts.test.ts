// Server-action tests against the seeded database. Every row they create is removed afterwards.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

const session = vi.hoisted(() => ({ user: null as null | { id: string; name: string; username: string; role: "Admin" | "User" | "SuperAdmin"; tenantId: string } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", async () => {
  const { hasPermission } = await import("@/lib/permissions");
  return {
    // Same contract as the real authorize(), minus the cookie lookup.
    authorize: async (permission: Parameters<typeof hasPermission>[1]) => {
      if (!session.user) throw new Error("Not signed in");
      if (!hasPermission(session.user.role, permission)) throw new Error(`Not allowed: ${permission}`);
      return session.user;
    },
  };
});

const { createReceipt, cancelReceipt } = await import("@/app/(app)/receipts/actions");

const created: string[] = [];
const touchedItems: string[] = [];
const touchedSlips: string[] = [];
const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const base = { policyId: "", renewalItemId: "", reference: "", notes: "", slipIds: "" };

beforeAll(async () => {
  const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  session.user = { id: admin.id, name: admin.name, username: "admin", role: "Admin", tenantId: admin.tenantId };
});

afterAll(async () => {
  // Reversals first (they point at the originals), then the originals and everything else.
  await prisma.dayBookEntry.deleteMany({ where: { sourceId: { in: created }, reversalOfId: { not: null } } });
  await prisma.dayBookEntry.deleteMany({ where: { sourceId: { in: created } } });
  await prisma.commission.deleteMany({ where: { receiptId: { in: created } } });
  await prisma.messageLog.deleteMany({ where: { relatedId: { in: created } } });
  await prisma.ownerPaidSlip.updateMany({ where: { id: { in: touchedSlips } }, data: { status: "CustomerOwes", closedByReceiptId: null } });
  await prisma.renewalItem.updateMany({ where: { id: { in: touchedItems } }, data: { status: "Due", paidOn: null, paidReceiptId: null } });
  await prisma.receipt.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("Receipts", () => {
  it("RD cash receipt: Collected, commission expected, Day Book cash in; cancel reverses it", async () => {
    const policy = await prisma.policy.findFirstOrThrow({ where: { policyNumber: "RD 2231-104" }, include: { customer: true } });
    const item = await prisma.renewalItem.findFirstOrThrow({ where: { policyId: policy.id, status: { in: ["Due", "Overdue"] } }, orderBy: { dueDate: "asc" } });
    touchedItems.push(item.id);

    const r = await createReceipt({ ok: false }, form({ ...base, customerId: policy.customerId, policyId: policy.id, renewalItemId: item.id, amount: "1000", mode: "Cash" }));
    expect(r).toMatchObject({ ok: true });
    created.push(r.id!);
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: r.id } });
    expect(receipt.rdStatus).toBe("Collected");
    expect((await prisma.renewalItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("Paid");
    const commission = await prisma.commission.findFirstOrThrow({ where: { receiptId: r.id } });
    expect([commission.gross, commission.tds, commission.net].map((d) => d.toFixed(2))).toEqual(["4.00", "0.08", "3.92"]);
    const [entry] = await prisma.dayBookEntry.findMany({ where: { sourceId: r.id } });
    expect([entry.direction, entry.amount.toFixed(2), entry.entryType]).toEqual(["In", "1000.00", "Collection"]);

    // Wrong amount for the instalment is refused
    const bad = await createReceipt({ ok: false }, form({ ...base, customerId: policy.customerId, policyId: policy.id, renewalItemId: item.id, amount: "999", mode: "Cash" }));
    expect(bad.ok).toBe(false);

    const c = await cancelReceipt({ ok: false }, form({ receiptId: r.id!, reason: "test" }));
    expect(c).toEqual({ ok: true });
    const entries = await prisma.dayBookEntry.findMany({ where: { sourceId: r.id }, orderBy: { createdAt: "asc" } });
    expect(entries.map((e) => e.direction)).toEqual(["In", "Out"]);
    expect(entries[1].reversalOfId).toBe(entries[0].id);
    expect((await prisma.renewalItem.findUniqueOrThrow({ where: { id: item.id } })).status).not.toBe("Paid");
    expect((await prisma.commission.findFirstOrThrow({ where: { receiptId: r.id } })).status).toBe("Cancelled");
    expect((await cancelReceipt({ ok: false }, form({ receiptId: r.id!, reason: "again" }))).ok).toBe(false);
  });

  it("UPI needs a UTR", async () => {
    const policy = await prisma.policy.findFirstOrThrow({ where: { policyNumber: "RD 2231-105" } });
    const r = await createReceipt({ ok: false }, form({ ...base, customerId: policy.customerId, policyId: policy.id, amount: "500", mode: "UPI" }));
    expect(r.ok).toBe(false);
    expect(r.fieldErrors).toHaveProperty("reference");
  });

  it("owner-paid adjustment closes the slip, posts a collection, stays out of the PO deposit list", async () => {
    const slip = await prisma.ownerPaidSlip.findFirstOrThrow({ where: { slipNo: "OWN-0014" } });
    touchedSlips.push(slip.id);
    const mismatch = await createReceipt({ ok: false }, form({ ...base, customerId: slip.customerId, amount: "900", mode: "Cash", slipIds: slip.id }));
    expect(mismatch.ok).toBe(false);

    const r = await createReceipt({ ok: false }, form({ ...base, customerId: slip.customerId, amount: "1000", mode: "Cash", slipIds: slip.id }));
    expect(r).toMatchObject({ ok: true });
    created.push(r.id!);
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: r.id } });
    expect([receipt.ownerPaid, receipt.rdStatus]).toEqual([true, null]);
    const after = await prisma.ownerPaidSlip.findUniqueOrThrow({ where: { id: slip.id } });
    expect([after.status, after.closedByReceiptId]).toEqual(["CollectedReturnToOwner", r.id]);
    expect(await prisma.dayBookEntry.count({ where: { sourceId: r.id, direction: "In" } })).toBe(1);

    // Cancelling the receipt reopens the slip
    await cancelReceipt({ ok: false }, form({ receiptId: r.id!, reason: "test" }));
    expect((await prisma.ownerPaidSlip.findUniqueOrThrow({ where: { id: slip.id } })).status).toBe("CustomerOwes");
  });

  it("staff cannot cancel", async () => {
    const arun = await prisma.user.findFirstOrThrow({ where: { username: "arun" } });
    const receipt = await prisma.receipt.findFirstOrThrow({ where: { status: "Saved" } });
    const prev = session.user;
    session.user = { id: arun.id, name: arun.name, username: "arun", role: "User", tenantId: arun.tenantId };
    await expect(cancelReceipt({ ok: false }, form({ receiptId: receipt.id, reason: "test" }))).rejects.toThrow(/Receipt.Cancel/);
    session.user = prev;
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } })).status).toBe("Saved");
  });
});
