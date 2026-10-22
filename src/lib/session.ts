import type { Role } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { loadAccess } from "@/lib/access";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasPermission, type Permission } from "@/lib/permissions";

export type SessionUser = { id: string; name: string; username: string; role: Role; tenantId: string };

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // Read only: pages can't renew the login cookie, so only SessionKeepAlive (real activity) extends the login.
  const session = await auth.api.getSession({ headers: await headers(), query: { disableRefresh: true } });
  if (!session) return null;
  // Role and "switched off" are read fresh, so a change in Settings → Users applies on the next click.
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, username: true, role: true, tenantId: true, active: true } });
  if (!u || !u.active) return null;
  await loadAccess(u.tenantId);
  return { id: u.id, name: u.name, username: u.username ?? "", role: u.role, tenantId: u.tenantId };
});

/** For pages: redirect to login when signed out. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: send users without the permission back to their dashboard. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasPermission(user.role, permission)) redirect("/dashboard?denied=1");
  return user;
}

/** For server actions and route handlers: throw instead of redirecting. */
export async function authorize(permission: Permission): Promise<SessionUser> {
  const user = await getSessionUser();
  // Login timed out: a save goes to the login page instead of an error screen.
  if (!user) redirect("/login");
  if (!hasPermission(user.role, permission)) throw new Error(`Not allowed: ${permission}`);
  return user;
}
