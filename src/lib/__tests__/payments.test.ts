// Several dues paid together, advance instalments, and cancelling a payment. Runs against the seeded database;
// every row it creates is removed afterwards.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addMonths, istToday } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { payableDues, seriesDate, STEP_MONTHS } from "@/lib/dues";
import { sum } from "@/lib/money";

const session = vi.hoisted(() => ({ user: null as null | { id: string; name: string; username: string; role: "Admin" | "User" | "SuperAdmin"; tenantId: string } }));
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

const { createReceipt, cancelReceipt, cancelPayment } = await import("@/app/(app)/receipts/actions");

/** Cash needs a denomination that adds up: ₹500 notes, the rest in coins. */
const cashFor = (amount: string) => JSON.stringify({ "500": Math.floor(Number(amount) / 500), coins: (Number(amount) % 500).toFixed(2) });
const form = (o: Record<string, string>) => {
  const f = new FormData();
  const withCash = o.mode === "Cash" && o.denominations === undefined && o.amount ? { ...o, denominations: cashFor(o.amount) } : o;
  Object.entries(withCash).forEach(([k, v]) => f.set(k, v));
  return f;
};
const base = { policyId: "", reference: "", notes: "", slipIds: "", mode: "Cash" };
const today = istToday();
const receiptIds: string[] = [];
const paymentIds: string[] = [];
const itemsBefore = new Set<string>();
let rd: Awaited<ReturnType<typeof loadPolicy>>;
let ins: Awaited<ReturnType<typeof loadPolicy>>;

const loadPolicy = (policyNumber: string) => prisma.policy.findFirstOrThrow({ where: { policyNumber }, include: { renewals: true } });
const payable = async (policyNumber: string) => {
  const p = await loadPolicy(policyNumber);
  return payableDues(p, p.renewals, today);
};
const pay = (dues: { policyId: string; count: number }[], amount: string) =>
  createReceipt({ ok: false }, form({ ...base, customerId: rd.customerId, dues: JSON.stringify(dues), amount }));

beforeAll(async () => {
  const admin = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  session.user = { id: admin.id, name: admin.name, username: "admin", role: "Admin", tenantId: admin.tenantId };
  rd = await loadPolicy("RD 3102-214");
  ins = await loadPolicy("POL-482603");
  for (const p of [rd, ins]) p.renewals.forEach((r) => itemsBefore.add(r.id));
});

afterAll(async () => {
  const created = await prisma.receipt.findMany({ where: { OR: [{ id: { in: receiptIds } }, { paymentId: { in: paymentIds } }] }, select: { id: true } });
  const ids = created.map((r) => r.id);
  await prisma.dayBookEntry.deleteMany({ where: { sourceId: { in: ids }, reversalOfId: { not: null } } });
  await prisma.dayBookEntry.deleteMany({ where: { sourceId: { in: ids } } });
  await prisma.commission.deleteMany({ where: { receiptId: { in: ids } } });
  await prisma.messageLog.deleteMany({ where: { relatedId: { in: [...ids, ...paymentIds] } } });
  // Advance instalments created by the tests go; seeded ones are unpaid again.
  await prisma.renewalItem.deleteMany({ where: { policyId: { in: [rd.id, ins.id] }, id: { notIn: [...itemsBefore] } } });
  for (const r of [...rd.renewals, ...ins.renewals]) {
    await prisma.renewalItem.update({ where: { id: r.id }, data: { status: r.status, paidOn: r.paidOn, paidReceiptId: r.paidReceiptId } });
  }
  await prisma.receipt.deleteMany({ where: { id: { in: ids } } });
  await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.$disconnect();
});

describe("Due dates", () => {
  it("advance dates continue each seeded policy's own series (RD month ends, yearly anniversaries)", async () => {
    const policies = await prisma.policy.findMany({ include: { renewals: { orderBy: { dueDate: "asc" } } } });
    let checked = 0;
    for (const p of policies) {
      const step = STEP_MONTHS[p.frequency];
      if (!step || p.renewals.length < 2) continue;
      const anchor = p.renewals[0].dueDate;
      const monthEndSeries = p.renewals.every((r) => r.dueDate.getUTCDate() === new Date(Date.UTC(r.dueDate.getUTCFullYear(), r.dueDate.getUTCMonth() + 1, 0)).getUTCDate());
      p.renewals.forEach((r, k) => expect(seriesDate(anchor, k * step, monthEndSeries), `${p.policyNumber} #${k}`).toEqual(r.dueDate));
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("unpaid first, then advance up to 12 months ahead, never on or before a stored due", async () => {
    const dues = await payable("RD 3102-214");
    const last = rd.renewals.reduce((m, r) => (r.dueDate > m ? r.dueDate : m), new Date(0));
    const open = dues.filter((d) => d.itemId);
    const advance = dues.filter((d) => !d.itemId);
    expect(open.length).toBeGreaterThan(0);
    expect(advance.every((d) => d.dueDate > last)).toBe(true);
    expect(dues.at(-1)!.dueDate <= addMonths(today, 12)).toBe(true);
    expect(dues.map((d) => d.dueDate.getTime())).toEqual([...dues].map((d) => d.dueDate.getTime()).sort((a, b) => a - b));
  });
});

describe("Paying several dues at once", () => {
  it("wrong total and more dues than allowed are refused, and nothing is written", async () => {
    const dues = await payable("RD 3102-214");
    const before = await prisma.receipt.count();
    const wrong = await pay([{ policyId: rd.id, count: 2 }], "1");
    expect(wrong.error).toMatch(/Amount must be/);
    const tooMany = await pay([{ policyId: rd.id, count: dues.length + 1 }], "1");
    expect(tooMany.error).toMatch(/can be paid now/);
    expect(await prisma.receipt.count()).toBe(before);
  });

  it("one due = a plain receipt, no payment", async () => {
    const [first] = await payable("POL-482603");
    const r = await pay([{ policyId: ins.id, count: 1 }], first.amount.toFixed(2));
    expect(r).toMatchObject({ ok: true, href: `/receipts/${r.id}` });
    receiptIds.push(r.id!);
    const receipt = await prisma.receipt.findUniqueOrThrow({ where: { id: r.id } });
    expect(receipt.paymentId).toBeNull();
    // Leave the insurance due for the next test.
    expect((await cancelReceipt({ ok: false }, form({ receiptId: r.id!, reason: "test" }))).ok).toBe(true);
  });

  it("RD (incl. advance months) + insurance → one PAY with a numbered RCPT per due; cancel reverses all", async () => {
    const rdDues = await payable("RD 3102-214");
    const open = rdDues.filter((d) => d.itemId).length;
    const rdCount = open + 2; // two advance months
    const [insDue] = await payable("POL-482603");
    const picked = [...rdDues.slice(0, rdCount), insDue];
    const total = sum(picked.map((d) => d.amount));

    const r = await pay([{ policyId: rd.id, count: rdCount }, { policyId: ins.id, count: 1 }], total.toFixed(2));
    expect(r).toMatchObject({ ok: true, href: `/payments/${r.id}` });
    paymentIds.push(r.id!);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: r.id }, include: { receipts: true } });
    expect(payment.paymentNo).toMatch(/^PAY-\d{4}$/);
    expect(payment.amount.toFixed(2)).toBe(total.toFixed(2));
    expect(payment.receipts).toHaveLength(rdCount + 1);
    expect(new Set(payment.receipts.map((x) => x.receiptNo)).size).toBe(rdCount + 1);
    expect(sum(payment.receipts.map((x) => x.amount)).toFixed(2)).toBe(total.toFixed(2));

    // Every due is paid; advance months now exist as Paid on the right dates.
    const items = await prisma.renewalItem.findMany({ where: { paidReceiptId: { in: payment.receipts.map((x) => x.id) } } });
    expect(items.map((i) => i.dueDate.getTime()).sort()).toEqual(picked.map((d) => d.dueDate.getTime()).sort());
    expect(items.every((i) => i.status === "Paid")).toBe(true);
    expect(payment.receipts.every((x) => x.renewalItemId)).toBe(true);
    // RD lines wait for the post office deposit with commission expected; the insurance line doesn't.
    const rdLines = payment.receipts.filter((x) => x.policyId === rd.id);
    expect(rdLines.every((x) => x.rdStatus === "Collected")).toBe(true);
    expect(await prisma.commission.count({ where: { receiptId: { in: rdLines.map((x) => x.id) } } })).toBe(rdCount);
    expect(await prisma.dayBookEntry.count({ where: { sourceId: { in: payment.receipts.map((x) => x.id) } } })).toBe(rdCount + 1);
    // The paid months are gone from what can be paid next.
    expect((await payable("RD 3102-214"))[0].dueDate > picked[rdCount - 1].dueDate).toBe(true);

    // A line can't be cancelled alone; the whole payment can.
    const line = await cancelReceipt({ ok: false }, form({ receiptId: payment.receipts[0].id, reason: "test" }));
    expect(line.error).toMatch(/Part of payment PAY-/);
    expect(await cancelPayment({ ok: false }, form({ paymentId: payment.id, reason: "test" }))).toEqual({ ok: true });
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { receipts: true } });
    expect(after.status).toBe("Cancelled");
    expect(after.receipts.every((x) => x.status === "Cancelled")).toBe(true);
    expect(await prisma.dayBookEntry.count({ where: { sourceId: { in: after.receipts.map((x) => x.id) }, direction: "Out" } })).toBe(rdCount + 1);
    expect(await prisma.renewalItem.count({ where: { paidReceiptId: { in: after.receipts.map((x) => x.id) } } })).toBe(0);
    expect((await cancelPayment({ ok: false }, form({ paymentId: payment.id, reason: "again" }))).ok).toBe(false);
  });
});
