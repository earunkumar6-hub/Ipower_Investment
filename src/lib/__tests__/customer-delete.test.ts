// Customers list "Action → Delete" (4 Nov 2026): only a customer with no records; Admin / Super Admin; type DELETE.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { inUseReason } from "@/lib/customer-delete";

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

const { deleteCustomer } = await import("@/app/(app)/customers/actions");
const started = new Date();
const users = {} as Record<"arun" | "admin", U>;

beforeAll(async () => {
  for (const k of ["arun", "admin"] as const) {
    const u = await prisma.user.findFirstOrThrow({ where: { username: k } });
    users[k] = { id: u.id, name: u.name, username: k, role: u.role, tenantId: u.tenantId };
  }
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.$disconnect();
});

describe("Delete customer", () => {
  it("names what keeps a customer", () => {
    expect(inUseReason({ policies: 2, receipts: 1, quotations: 0 })).toBe("Has 2 products, 1 receipt – can't be deleted");
    expect(inUseReason({ policies: 0 })).toBeNull();
  });

  it("an unused customer is deleted with their mobiles and follow-ups; logged", async () => {
    const tenantId = users.admin.tenantId;
    const c = await prisma.customer.create({
      data: { tenantId, name: "Vitest Duplicate", mobile: "6000044455", ownerId: users.arun.id, mobiles: { create: { tenantId, number: "6000044455", isWhatsApp: true, sort: 0 } } },
    });
    await prisma.call.create({ data: { tenantId, customerId: c.id, ownerId: users.arun.id, dueAt: new Date(Date.now() + 86_400_000), note: "test" } });
    session.user = users.arun; // staff can't delete
    await expect(deleteCustomer(c.id, "DELETE")).rejects.toThrow(/Not allowed: Customer.Delete/);
    session.user = users.admin;
    expect((await deleteCustomer(c.id, "delete")).error).toBe("Type DELETE to confirm");
    expect(await deleteCustomer(c.id, "DELETE")).toEqual({ ok: true, message: "Vitest Duplicate deleted" });
    expect(await prisma.customer.findUnique({ where: { id: c.id } })).toBeNull();
    expect([await prisma.customerMobile.count({ where: { customerId: c.id } }), await prisma.call.count({ where: { customerId: c.id } })]).toEqual([0, 0]);
    expect(await prisma.auditLog.count({ where: { entityId: c.id, action: "Deleted" } })).toBe(1);
  });

  it("a customer with records is refused and kept", async () => {
    session.user = users.admin;
    const rajesh = await prisma.customer.findFirstOrThrow({ where: { name: "Rajesh Kumar" } });
    const r = await deleteCustomer(rajesh.id, "DELETE");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^Has \d+ products.*can't be deleted$/);
    expect(await prisma.customer.findUnique({ where: { id: rajesh.id } })).not.toBeNull();
  });
});
