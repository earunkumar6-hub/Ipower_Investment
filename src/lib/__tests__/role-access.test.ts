// Settings → Roles and access, Users (Super Admin only). Rows it creates are removed afterwards.
import { verifyPassword } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadAccess, resetAccess } from "@/lib/access";
import { prisma } from "@/lib/db";
import { hasPermission, seesAll } from "@/lib/permissions";

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

const { saveRoleAccess, resetRoleAccess, createUser, updateUser, setUserPassword, deleteUser } = await import("@/app/(app)/settings/access-actions");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const users: Record<string, U> = {};
const as = (u: string) => (session.user = users[u]);
const started = new Date();
const grid = (rows: { role: string; permission: string; allowed: boolean }[]) => form({ grid: JSON.stringify(rows) });
const reload = async () => {
  resetAccess();
  await loadAccess(users.owner.tenantId);
};

beforeAll(async () => {
  for (const [key, username] of [["owner", "superadmin"], ["admin", "admin"], ["arun", "arun"]]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    users[key] = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
  }
});

afterAll(async () => {
  await prisma.rolePermission.deleteMany({ where: { tenantId: users.owner.tenantId } });
  const made = await prisma.user.findMany({ where: { OR: [{ username: { startsWith: "vt_" } }, { email: { startsWith: "deleted-" }, createdAt: { gte: started } }] }, select: { id: true } });
  await prisma.customer.deleteMany({ where: { name: "Vitest handover customer" } });
  await prisma.session.deleteMany({ where: { userId: { in: made.map((m) => m.id) } } });
  await prisma.authAccount.deleteMany({ where: { userId: { in: made.map((m) => m.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: made.map((m) => m.id) } } });
  await prisma.auditLog.deleteMany({ where: { createdAt: { gte: started }, entity: { in: ["Access", "User"] } } });
  resetAccess();
  await prisma.$disconnect();
});

describe("Defaults", () => {
  it("are the same rules as before", () => {
    expect([seesAll("SuperAdmin"), seesAll("Admin"), seesAll("User")]).toEqual([true, true, false]);
    expect(hasPermission("Admin", "Receipt.Cancel")).toBe(true);
    expect(hasPermission("User", "Receipt.Cancel")).toBe(false);
    expect(hasPermission("Admin", "Access.Manage")).toBe(false);
  });
});

describe("Roles and access (Super Admin only)", () => {
  it("Admins and Users can't change access or logins", async () => {
    for (const u of ["admin", "arun"]) {
      as(u);
      await expect(saveRoleAccess({ ok: false }, grid([]))).rejects.toThrow(/Not allowed/);
      await expect(createUser({ ok: false }, form({}))).rejects.toThrow(/Not allowed/);
    }
  });

  it("a permission given to Users applies at once; ticking back the default removes the stored change; Access.Manage can't be given", async () => {
    as("owner");
    expect(await saveRoleAccess({ ok: false }, grid([
      { role: "User", permission: "Receipt.Cancel", allowed: true },
      { role: "Admin", permission: "Expense.Approve", allowed: false },
      { role: "User", permission: "Access.Manage", allowed: true },
    ]))).toMatchObject({ ok: true, message: "2 change(s) saved" });
    await reload();
    expect(hasPermission("User", "Receipt.Cancel")).toBe(true);
    expect(hasPermission("Admin", "Expense.Approve")).toBe(false);
    expect(hasPermission("User", "Access.Manage")).toBe(false);
    expect(await prisma.rolePermission.count({ where: { tenantId: users.owner.tenantId } })).toBe(2);

    await saveRoleAccess({ ok: false }, grid([{ role: "User", permission: "Receipt.Cancel", allowed: false }]));
    expect(await prisma.rolePermission.count({ where: { tenantId: users.owner.tenantId, permission: "Receipt.Cancel" } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entity: "Access", createdAt: { gte: started } } })).toBe(2);

    expect((await resetRoleAccess()).ok).toBe(true);
    await reload();
    expect(hasPermission("Admin", "Expense.Approve")).toBe(true);
    expect(await prisma.rolePermission.count({ where: { tenantId: users.owner.tenantId } })).toBe(0);
  });

  it("'see all records' can be given to Users", async () => {
    as("owner");
    await saveRoleAccess({ ok: false }, grid([{ role: "User", permission: "Data.SeeAll", allowed: true }]));
    await reload();
    expect(seesAll("User")).toBe(true);
    await resetRoleAccess();
    await reload();
    expect(seesAll("User")).toBe(false);
  });
});

describe("Users", () => {
  const newUser = (o: Record<string, string> = {}) => form({ name: "Vitest Staff", username: "vt_staff1", role: "User", password: "secret123", confirm: "secret123", ...o });

  it("adds a login with a hashed password; username unique; passwords checked", async () => {
    as("owner");
    expect((await createUser({ ok: false }, newUser({ password: "short", confirm: "short" }))).fieldErrors).toHaveProperty("password");
    expect((await createUser({ ok: false }, newUser({ confirm: "different1" }))).fieldErrors).toHaveProperty("confirm");
    expect((await createUser({ ok: false }, newUser({ username: "arun" }))).fieldErrors).toHaveProperty("username");
    expect((await createUser({ ok: false }, newUser())).ok).toBe(true);
    const u = await prisma.user.findFirstOrThrow({ where: { username: "vt_staff1" }, include: { authAccounts: true } });
    expect(u).toMatchObject({ role: "User", active: true, tenantId: users.owner.tenantId });
    expect(await verifyPassword({ hash: u.authAccounts[0].password!, password: "secret123" })).toBe(true);
  });

  it("role change and login off (signs out); the owner's login can't be changed", async () => {
    as("owner");
    const u = await prisma.user.findFirstOrThrow({ where: { username: "vt_staff1" } });
    await prisma.session.create({ data: { id: `ses_vt_${started.getTime()}`, token: `tok_vt_${started.getTime()}`, userId: u.id, expiresAt: new Date(Date.now() + 3_600_000) } });
    expect((await updateUser({ ok: false }, form({ userId: u.id, role: "Admin", active: "off" }))).ok).toBe(true);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).toMatchObject({ role: "Admin", active: false });
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
    expect((await updateUser({ ok: false }, form({ userId: users.owner.id, role: "User", active: "off" }))).error).toMatch(/owner/);
  });

  it("sets a new password", async () => {
    as("owner");
    const u = await prisma.user.findFirstOrThrow({ where: { username: "vt_staff1" } });
    expect((await setUserPassword({ ok: false }, form({ userId: u.id, password: "newpass99", confirm: "newpass99" }))).ok).toBe(true);
    const acc = await prisma.authAccount.findFirstOrThrow({ where: { userId: u.id } });
    expect(await verifyPassword({ hash: acc.password!, password: "newpass99" })).toBe(true);
  });
});

describe("Delete a login", () => {
  it("the owner can't be deleted; work must be handed over; the login is gone, the name stays", async () => {
    as("owner");
    expect((await deleteUser({ ok: false }, form({ userId: users.owner.id, handOverTo: "", confirm: "DELETE" }))).error).toMatch(/owner/);
    expect((await createUser({ ok: false }, form({ name: "Vitest Leaver", username: "vt_leaver", role: "User", password: "leaver123", confirm: "leaver123" }))).ok).toBe(true);
    const u = await prisma.user.findFirstOrThrow({ where: { username: "vt_leaver" } });
    const c = await prisma.customer.create({ data: { tenantId: users.owner.tenantId, name: "Vitest handover customer", mobile: "6000033344", ownerId: u.id } });

    expect((await deleteUser({ ok: false }, form({ userId: u.id, handOverTo: "", confirm: "delete" }))).fieldErrors).toHaveProperty("handOverTo");
    expect((await deleteUser({ ok: false }, form({ userId: u.id, handOverTo: users.arun.id, confirm: "no" }))).fieldErrors).toHaveProperty("confirm");
    expect((await deleteUser({ ok: false }, form({ userId: u.id, handOverTo: users.arun.id, confirm: "DELETE" }))).ok).toBe(true);

    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).ownerId).toBe(users.arun.id);
    const gone = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(gone).toMatchObject({ active: false, username: null, name: "Vitest Leaver" });
    expect(gone.deletedAt).not.toBeNull();
    expect(await prisma.authAccount.count({ where: { userId: u.id } })).toBe(0);
    // The username can be used again.
    expect((await createUser({ ok: false }, form({ name: "Vitest Leaver 2", username: "vt_leaver", role: "User", password: "leaver123", confirm: "leaver123" }))).ok).toBe(true);
  });
});
