// Settings → Products and schemes: deleting a product or scheme that nothing uses yet.
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

const { saveProduct, saveScheme, addCustomField, deleteScheme, deleteProduct } = await import("@/app/(app)/settings/actions");

const started = new Date();
const NAME = "Test Product Delete";
const users: Record<"admin" | "arun", U> = {} as never;
const as = (u: U) => { session.user = u; };
const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
let productId = "";

beforeAll(async () => {
  for (const k of ["admin", "arun"] as const) {
    const u = await prisma.user.findFirstOrThrow({ where: { username: k } });
    users[k] = { id: u.id, name: u.name, username: k, role: u.role, tenantId: u.tenantId };
  }
  as(users.admin);
  const r = await saveProduct({ ok: false }, form({
    name: NAME, productType: "PoTd", partner: "Post Office", invoiceRule: "None", payModes: ["OneTime"], lockInMonths: "",
    fields: ["policyNumber"], requiredFields: [], active: "on",
  }));
  productId = r.id!;
  await saveScheme({ ok: false }, form({ productId, name: "TD 1 year", tenure: "1", tenureUnit: "years", rate: "6.9", effectiveFrom: "2026-04-01" }));
  await saveScheme({ ok: false }, form({ productId, name: "TD 3 years", tenure: "3", tenureUnit: "years", rate: "" }));
  await addCustomField({ ok: false }, form({ productId, label: "Branch", type: "Text" }));
});

afterAll(async () => {
  const ids = (await prisma.product.findMany({ where: { name: NAME }, select: { id: true } })).map((p) => p.id);
  await prisma.schemeRate.deleteMany({ where: { scheme: { productId: { in: ids } } } });
  await prisma.scheme.deleteMany({ where: { productId: { in: ids } } });
  await prisma.productCustomField.deleteMany({ where: { productId: { in: ids } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: started } } });
  await prisma.$disconnect();
});

describe("Deleting products and schemes", () => {
  it("only Admin and Super Admin can delete", async () => {
    as(users.arun);
    await expect(deleteProduct(productId)).rejects.toThrow("Not allowed: Settings.Edit");
  });

  it("deletes an unused scheme with its rates and logs it", async () => {
    as(users.admin);
    const s = await prisma.scheme.findFirstOrThrow({ where: { productId, name: "TD 1 year" } });
    expect((await deleteScheme(s.id)).ok).toBe(true);
    expect(await prisma.scheme.count({ where: { id: s.id } })).toBe(0);
    expect(await prisma.schemeRate.count({ where: { schemeId: s.id } })).toBe(0);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: s.id, action: "Deleted" } });
    expect(log.before).toMatchObject({ tenure: "1 year" });
  });

  it("refuses to delete a product or scheme that accounts use", async () => {
    as(users.admin);
    const used = await prisma.product.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, policies: { some: {} } } });
    expect((await deleteProduct(used.id)).error).toMatch(/is used by \d+ account.*Untick Active/);
    expect(await prisma.product.count({ where: { id: used.id } })).toBe(1);
    const usedScheme = await prisma.scheme.findFirst({ where: { product: { tenantId: users.admin.tenantId }, policies: { some: {} } } });
    if (usedScheme) expect((await deleteScheme(usedScheme.id)).error).toMatch(/can't be deleted/);
  });

  it("deletes an unused product with its schemes and custom fields", async () => {
    as(users.admin);
    expect((await deleteProduct(productId)).ok).toBe(true);
    expect(await prisma.product.count({ where: { id: productId } })).toBe(0);
    expect(await prisma.scheme.count({ where: { productId } })).toBe(0);
    expect(await prisma.productCustomField.count({ where: { productId } })).toBe(0);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: productId, action: "Deleted" } });
    expect(log.before).toMatchObject({ name: NAME, schemes: "TD 3 years" });
    expect((await deleteProduct(productId)).error).toMatch(/no longer exists/);
  });
});
