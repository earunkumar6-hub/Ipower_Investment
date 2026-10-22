import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PERMISSIONS, setAccessOverrides, type Permission } from "@/lib/permissions";

// Roles and access saved by the Super Admin (RolePermission), kept in memory for a few seconds so every
// permission check in a request uses the same, current rules. Saving clears it at once (`resetAccess`).

const TTL_MS = 5_000;
let loadedAt = 0;
let loadedFor = "";

export async function loadAccess(tenantId: string) {
  if (loadedFor === tenantId && Date.now() - loadedAt < TTL_MS) return;
  const rows = await prisma.rolePermission.findMany({ where: { tenantId } });
  const o: Partial<Record<Role, Partial<Record<Permission, boolean>>>> = {};
  for (const r of rows) {
    if (!(PERMISSIONS as readonly string[]).includes(r.permission)) continue;
    (o[r.role] ??= {})[r.permission as Permission] = r.allowed;
  }
  setAccessOverrides(o);
  loadedFor = tenantId;
  loadedAt = Date.now();
}

export function resetAccess() {
  loadedAt = 0;
}
