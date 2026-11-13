// Change set phase 3a – customers: CIF numbers, photo, follow-ups on the customer, premature closure button.
// Rows and files it creates are removed afterwards.
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setAccessOverrides } from "@/lib/permissions";
import { closureButton } from "@/lib/closure";
import { loadCustomer360 } from "@/lib/customer-360";
import { prisma } from "@/lib/db";
import { openCalls } from "@/lib/leads";

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

const { scheduleCall, saveCallOutcome } = await import("@/app/(app)/leads/actions");
const { changeCustomerPhoto } = await import("@/app/(app)/customers/actions");

const form = (o: Record<string, string | File>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const users: Record<string, U> = {};
const as = (u: string) => (session.user = users[u]);
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fmt = (x: Date) => x.toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 5.5 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
const calls: string[] = [];
let customerId = "";
let photoBefore: string | null = null;
let createdCustomer = "";

beforeAll(async () => {
  for (const username of ["arun", "divya", "admin"]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    users[username] = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
  }
  const c = await prisma.customer.findFirstOrThrow({ where: { tenantId: users.arun.tenantId, ownerId: users.arun.id }, orderBy: { createdAt: "asc" } });
  customerId = c.id;
  photoBefore = c.photoPath;
});

afterAll(async () => {
  await prisma.call.deleteMany({ where: { OR: [{ id: { in: calls } }, { customerId }] , createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
  await prisma.auditLog.deleteMany({ where: { entityId: customerId, action: "Photo" } });
  await prisma.customer.update({ where: { id: customerId }, data: { photoPath: photoBefore } });
  await rm(path.join(process.cwd(), "storage", "photos", `${customerId}.png`), { force: true });
  if (createdCustomer) await prisma.customer.delete({ where: { id: createdCustomer } });
  await prisma.$disconnect();
});

describe("Premature closure button", () => {
  const today = d("2026-10-21");
  const product = (prematureClosure: boolean, closeDuringLockIn: boolean) => ({ prematureClosure, closeDuringLockIn });

  it("mutual funds: always Withdraw", () => {
    expect(closureButton({ productType: "MutualFund", product: product(false, false) }, null, today, fmt)).toEqual({ state: "active", withdraw: true, lockInUntil: null });
  });
  it("not allowed → hidden with 'Not allowed'", () => {
    expect(closureButton({ productType: "PoTd", product: product(false, false) }, d("2027-01-01"), today, fmt)).toEqual({ state: "hidden", text: "Not allowed" });
  });
  it("allowed, inside lock-in, closing during lock-in off → greyed out until the lock-in ends", () => {
    expect(closureButton({ productType: "PoTd", product: product(true, false) }, d("2027-01-01"), today, fmt))
      .toEqual({ state: "locked", until: d("2027-01-01"), text: "Greyed out until 2027-01-01 (lock-in)" });
  });
  it("allowed, inside lock-in, closing during lock-in on → active with no date limit", () => {
    expect(closureButton({ productType: "PoTd", product: product(true, true) }, d("2027-01-01"), today, fmt)).toEqual({ state: "active", withdraw: false, lockInUntil: null });
  });
  it("allowed, lock-in over (or none) → active", () => {
    expect(closureButton({ productType: "PoTd", product: product(true, false) }, d("2026-01-01"), today, fmt)).toEqual({ state: "active", withdraw: false, lockInUntil: d("2026-01-01") });
    expect(closureButton({ productType: "Insurance", product: product(true, false) }, null, today, fmt)).toEqual({ state: "active", withdraw: false, lockInUntil: null });
    expect(closureButton({ productType: "Insurance", product: null }, null, today, fmt)).toMatchObject({ state: "active" });
  });
});

describe("Customer ID (CIF)", () => {
  it("every customer has one, CIF-000124 style, unique; new customers get the next one", async () => {
    const all = await prisma.customer.findMany({ where: { tenantId: users.arun.tenantId }, select: { cifNo: true } });
    expect(all.every((c) => /^CIF-\d{6,}$/.test(c.cifNo))).toBe(true);
    expect(new Set(all.map((c) => c.cifNo)).size).toBe(all.length);
    const max = Math.max(...all.map((c) => Number(c.cifNo.slice(4))));
    const c = await prisma.customer.create({ data: { tenantId: users.arun.tenantId, name: "Vitest CIF", mobile: "6000099911", ownerId: users.arun.id } });
    createdCustomer = c.id;
    expect(Number(c.cifNo.slice(4))).toBeGreaterThan(max);
  });
});

describe("Follow-ups on the customer", () => {
  it("added on the customer: goes to the owner, joins calls open, shows as the badge and in the table", async () => {
    as("arun");
    expect(await scheduleCall({ ok: false }, form({ kind: "customer", refId: customerId, callDate: tomorrow, callTime: "11:00", note: "Vitest – discuss SIP top-up" }))).toEqual({ ok: true });
    const call = await prisma.call.findFirstOrThrow({ where: { customerId, note: "Vitest – discuss SIP top-up" } });
    calls.push(call.id);
    expect(call.ownerId).toBe(users.arun.id);

    const open = await openCalls(users.arun);
    expect(open.find((o) => o.id === call.id)).toMatchObject({ kind: "customer", href: `/customers/${customerId}`, forLabel: "Customer" });

    const view = await loadCustomer360(users.arun, customerId);
    expect(view!.followUps.find((f) => f.id === call.id)).toMatchObject({ type: "Customer", status: "Open", owner: users.arun.name });
    expect(view!.nextFollowUp).not.toBeNull();
  });

  it("another user can't add one on someone else's customer", async () => {
    as("divya");
    expect((await scheduleCall({ ok: false }, form({ kind: "customer", refId: customerId, callDate: tomorrow, callTime: "12:00", note: "x" }))).ok).toBe(false);
  });

  it("ends with Done or No answer (which books the next call on the same customer)", async () => {
    as("arun");
    const call = await prisma.call.findFirstOrThrow({ where: { id: calls[0] } });
    expect((await saveCallOutcome({ ok: false }, form({ callId: call.id, outcome: "Interested", note: "", reason: "", callDate: "", callTime: "" }))).ok).toBe(false);
    expect(await saveCallOutcome({ ok: false }, form({ callId: call.id, outcome: "NoAnswer", note: "Not reachable", reason: "", callDate: tomorrow, callTime: "16:00" }))).toEqual({ ok: true });
    const next = await prisma.call.findFirstOrThrow({ where: { customerId, outcome: null, id: { not: call.id } }, orderBy: { createdAt: "desc" } });
    calls.push(next.id);
    expect(await saveCallOutcome({ ok: false }, form({ callId: next.id, outcome: "Done", note: "Spoke", reason: "", callDate: "", callTime: "" }))).toEqual({ ok: true });
    const view = await loadCustomer360(users.arun, customerId);
    expect(view!.followUps.find((f) => f.id === call.id)?.status).toBe("No answer – rescheduled");
    expect(view!.followUps.find((f) => f.id === next.id)?.status).toBe("Done");
  });
});

describe("Customer photo", () => {
  const png = () => new File([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")], "me.png", { type: "image/png" });

  it("JPG / PNG only, up to 2 MB; saved, logged, shown by the owner check", async () => {
    as("arun");
    expect((await changeCustomerPhoto({ ok: false }, form({ customerId, photo: new File(["x"], "a.gif", { type: "image/gif" }) }))).error).toMatch(/JPG or PNG/);
    expect((await changeCustomerPhoto({ ok: false }, form({ customerId, photo: new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }) }))).error).toMatch(/2 MB/);
    as("divya");
    setAccessOverrides({ User: { "Records.SeeAll": false } }); // #10: only when 'work on every customer' is off
    expect((await changeCustomerPhoto({ ok: false }, form({ customerId, photo: png() }))).ok).toBe(false);
    setAccessOverrides({});
    as("arun");
    expect(await changeCustomerPhoto({ ok: false }, form({ customerId, photo: png() }))).toEqual({ ok: true });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).photoPath).toBe(`${customerId}.png`);
    expect(await prisma.auditLog.count({ where: { entityId: customerId, action: "Photo" } })).toBe(1);
  });
});
