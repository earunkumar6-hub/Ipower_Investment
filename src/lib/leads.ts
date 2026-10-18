import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { seesAll } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";

/** Users act on their own leads and calls; Admin and Super Admin on the whole agency. */
export const canActOn = (user: SessionUser, ownerId: string) => seesAll(user.role) || ownerId === user.id;

export const ownerScope = (user: SessionUser) => (seesAll(user.role) ? {} : { ownerId: user.id });

export async function userNames(tenantId: string) {
  const users = await db.user.findMany({ where: { tenantId }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
  return users;
}

export type OpenCall = {
  id: string;
  leadId: string;
  leadNo: string;
  name: string;
  mobile: string;
  ownerId: string;
  ownerName: string;
  dueAt: string; // ISO
  note: string | null;
  mine: boolean;
};

/** Open calls (no outcome yet) the user can see, oldest due first. */
export async function openCalls(user: SessionUser): Promise<OpenCall[]> {
  const where: Prisma.CallWhereInput = { tenantId: user.tenantId, outcome: null, ...ownerScope(user) };
  const [calls, users] = await Promise.all([
    db.call.findMany({ where, include: { lead: true }, orderBy: { dueAt: "asc" } }),
    userNames(user.tenantId),
  ]);
  return calls.map((c) => ({
    id: c.id,
    leadId: c.leadId,
    leadNo: c.lead.leadNo,
    name: c.lead.name,
    mobile: c.lead.mobile,
    ownerId: c.ownerId,
    ownerName: users.find((u) => u.id === c.ownerId)?.name ?? "—",
    dueAt: c.dueAt.toISOString(),
    note: c.note,
    mine: c.ownerId === user.id,
  }));
}
