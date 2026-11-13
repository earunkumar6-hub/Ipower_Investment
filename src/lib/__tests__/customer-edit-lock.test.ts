// "Someone is editing this customer" ticket (QA D-02, 13 Nov 2026): one live ticket per customer, taken atomically.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { acquireEditLock, editLockHolder, releaseEditLock, takeOverEditLock } from "@/lib/customer-lock";

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

const { editCustomer, startEditing, stopEditing, takeOverEditing } = await import("@/app/(app)/customers/actions");

const started = new Date();
const users = {} as Record<"arun" | "divya" | "admin", U>;
const as = (u: U) => { session.user = u; };
let hari: { id: string; name: string; mobile: string; email: string | null; address: string | null; mobiles: { number: string; isWhatsApp: boolean }[] };
const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const edit = (address: string) => editCustomer({ ok: false }, form({
  customerId: hari.id, name: hari.name, email: "", address, mobile: hari.mobiles.map((m) => m.number), whatsApp: hari.mobiles.map((_, i) => String(i)),
}));

beforeAll(async () => {
  for (const k of ["arun", "divya", "admin"] as const) {
    const u = await prisma.user.findFirstOrThrow({ where: { username: k } });
    users[k] = { id: u.id, name: u.name, username: k, role: u.role, tenantId: u.tenantId };
  }
  hari = await prisma.customer.findFirstOrThrow({ where: { name: "Hari Prasad" }, include: { mobiles: { orderBy: { sort: "asc" } } } });
  await prisma.customerEditLock.deleteMany({ where: { customerId: hari.id } });
});

afterAll(async () => {
  await prisma.customerEditLock.deleteMany({ where: { customerId: hari.id } });
  await prisma.customer.update({ where: { id: hari.id }, data: { address: hari.address, email: hari.email } });
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.$disconnect();
});

const t = () => users.arun.tenantId;

describe("the editing ticket", () => {
  it("the first person gets it; a second is told who has it; the holder can renew", async () => {
    expect(await acquireEditLock(prisma, t(), hari.id, users.arun.id)).toEqual({ ok: true });
    const second = await acquireEditLock(prisma, t(), hari.id, users.divya.id);
    expect(second).toMatchObject({ ok: false, holder: users.arun.name });
    expect(await acquireEditLock(prisma, t(), hari.id, users.arun.id)).toEqual({ ok: true }); // renew
    expect((await editLockHolder(prisma, hari.id, users.divya.id))?.holder).toBe(users.arun.name);
    expect(await editLockHolder(prisma, hari.id, users.arun.id)).toBeNull(); // not "other" for the holder
  });

  it("only the holder's release frees it", async () => {
    await releaseEditLock(prisma, hari.id, users.divya.id);
    expect((await acquireEditLock(prisma, t(), hari.id, users.divya.id)).ok).toBe(false);
    await releaseEditLock(prisma, hari.id, users.arun.id);
    expect((await acquireEditLock(prisma, t(), hari.id, users.divya.id)).ok).toBe(true);
    await releaseEditLock(prisma, hari.id, users.divya.id);
  });

  it("an expired ticket can be taken by someone else", async () => {
    await acquireEditLock(prisma, t(), hari.id, users.arun.id);
    await prisma.customerEditLock.update({ where: { customerId: hari.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await editLockHolder(prisma, hari.id, users.divya.id)).toBeNull();
    expect((await acquireEditLock(prisma, t(), hari.id, users.divya.id)).ok).toBe(true);
    await releaseEditLock(prisma, hari.id, users.divya.id);
  });

  it("two people opening at the same instant: exactly one gets it", async () => {
    for (let round = 0; round < 5; round++) {
      const results = await Promise.all([users.arun, users.divya, users.admin].map((u) => acquireEditLock(prisma, t(), hari.id, u.id)));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      await prisma.customerEditLock.deleteMany({ where: { customerId: hari.id } });
    }
  });

  it("an Admin can take over; a User cannot", async () => {
    as(users.arun);
    expect(await startEditing(hari.id)).toMatchObject({ ok: true, details: { id: hari.id } });
    as(users.divya);
    const blocked = await startEditing(hari.id);
    expect(blocked).toMatchObject({ ok: false, holder: users.arun.name, canTakeOver: false });
    expect(await takeOverEditing(hari.id)).toMatchObject({ ok: false, error: expect.stringMatching(/Admin/) });
    as(users.admin);
    expect(await takeOverEditing(hari.id)).toMatchObject({ ok: true });
    expect((await editLockHolder(prisma, hari.id, users.arun.id))?.holder).toBe(users.admin.name);
    expect(await prisma.auditLog.count({ where: { entityId: hari.id, action: "EditTakeover" } })).toBe(1);
    expect(await takeOverEditLock(prisma, t(), hari.id, users.admin.id)).toBeNull();
    await prisma.customerEditLock.deleteMany({ where: { customerId: hari.id } });
  });
});

describe("saving Edit details with the ticket", () => {
  it("is refused while someone else holds it, and works for the holder (who gives the ticket back)", async () => {
    as(users.arun);
    expect(await startEditing(hari.id)).toMatchObject({ ok: true, details: { id: hari.id } });

    as(users.divya);
    const refused = await edit("Divya's address");
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(new RegExp(`${users.arun.name} is editing this customer`));

    as(users.arun);
    expect((await edit("Arun's address")).ok).toBe(true);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: hari.id } })).address).toBe("Arun's address");
    expect(await prisma.customerEditLock.count({ where: { customerId: hari.id } })).toBe(0); // released by the save

    as(users.divya);
    expect((await edit("Divya's address")).ok).toBe(true); // now free
  });

  it("an expired ticket does not block a save (the version check still protects it)", async () => {
    as(users.arun);
    await startEditing(hari.id);
    await prisma.customerEditLock.update({ where: { customerId: hari.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    as(users.divya);
    expect((await edit("After expiry")).ok).toBe(true);
  });

  it("stopEditing gives the ticket back", async () => {
    as(users.arun);
    await startEditing(hari.id);
    await stopEditing(hari.id);
    expect(await prisma.customerEditLock.count({ where: { customerId: hari.id } })).toBe(0);
  });

  it("deleting a customer takes its ticket with it", async () => {
    const c = await prisma.customer.create({ data: { tenantId: t(), name: "Vitest Lock Customer", mobile: "9000012399", ownerId: users.arun.id } });
    await acquireEditLock(prisma, t(), c.id, users.arun.id);
    await prisma.customer.delete({ where: { id: c.id } });
    expect(await prisma.customerEditLock.count({ where: { customerId: c.id } })).toBe(0);
  });
});
