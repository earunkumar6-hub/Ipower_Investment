import type { Role } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { hasPermission, type Permission } from "@/lib/permissions";

export type SessionUser = { id: string; name: string; username: string; role: Role; tenantId: string };

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as typeof session.user & { username: string; role: Role; tenantId: string };
  return { id: u.id, name: u.name, username: u.username, role: u.role, tenantId: u.tenantId };
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
  if (!user) throw new Error("Not signed in");
  if (!hasPermission(user.role, permission)) throw new Error(`Not allowed: ${permission}`);
  return user;
}
