"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { resetAccess } from "@/lib/access";
import { audit } from "@/lib/audit";
import { ownedWork } from "@/lib/users";
import { db } from "@/lib/db";
import { isDefaultAllowed, LOCKED_PERMISSIONS, PERMISSIONS, ROLE_LABEL, type Permission } from "@/lib/permissions";
import { authorize } from "@/lib/session";

// Settings → Roles and access, and Users: Super Admin only (Access.Manage, which can't be given away).

const EDITABLE_ROLES = ["Admin", "User"] as const;
type EditableRole = (typeof EDITABLE_ROLES)[number];

const gridSchema = z.array(z.object({
  role: z.enum(EDITABLE_ROLES),
  permission: z.enum(PERMISSIONS),
  allowed: z.boolean(),
})).max(200);

/** Saves the Admin / User tick boxes: only what differs from the built-in default is stored. Logged. */
export async function saveRoleAccess(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Access.Manage");
  let parsed;
  try {
    parsed = gridSchema.safeParse(JSON.parse(String(form.get("grid") ?? "[]")));
  } catch {
    return { ok: false, error: "Reload the page and try again" };
  }
  if (!parsed.success) return { ok: false, error: "Reload the page and try again" };
  const rows = parsed.data.filter((r) => !LOCKED_PERMISSIONS.includes(r.permission));

  const changes = await db.$transaction(async (tx) => {
    const before = await tx.rolePermission.findMany({ where: { tenantId: user.tenantId } });
    const now = (role: EditableRole, p: Permission) => before.find((b) => b.role === role && b.permission === p)?.allowed ?? isDefaultAllowed(role, p);
    const changed: string[] = [];
    for (const r of rows) {
      if (now(r.role, r.permission) === r.allowed) continue;
      changed.push(`${ROLE_LABEL[r.role]} ${r.allowed ? "+" : "−"} ${r.permission}`);
      if (r.allowed === isDefaultAllowed(r.role, r.permission)) {
        await tx.rolePermission.deleteMany({ where: { tenantId: user.tenantId, role: r.role, permission: r.permission } });
      } else {
        await tx.rolePermission.upsert({
          where: { tenantId_role_permission: { tenantId: user.tenantId, role: r.role, permission: r.permission } },
          create: { tenantId: user.tenantId, role: r.role, permission: r.permission, allowed: r.allowed, updatedById: user.id },
          update: { allowed: r.allowed, updatedById: user.id },
        });
      }
    }
    if (changed.length) await audit(tx, user, { entity: "Access", entityId: user.tenantId, action: "Updated", summary: `Roles and access: ${changed.join(", ")}` });
    return changed;
  });
  resetAccess();
  revalidatePath("/", "layout");
  return { ok: true, message: changes.length ? `${changes.length} change(s) saved` : "No changes" };
}

/** Back to the built-in rules for Admin and User. */
export async function resetRoleAccess(): Promise<ActionResult> {
  const user = await authorize("Access.Manage");
  await db.$transaction(async (tx) => {
    const n = await tx.rolePermission.deleteMany({ where: { tenantId: user.tenantId } });
    if (n.count) await audit(tx, user, { entity: "Access", entityId: user.tenantId, action: "Reset", summary: `Roles and access reset to defaults (${n.count} change(s) removed)` });
  });
  resetAccess();
  revalidatePath("/", "layout");
  return { ok: true, message: "Back to the default access" };
}

// ── Users ──

const password = z.string().min(8, "Password needs at least 8 characters").max(72);
const newUserSchema = z.object({
  name: z.string().trim().min(2, "Enter the name").max(60),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._]{3,30}$/, "Username: 3–30 letters, digits, dot or underscore"),
  role: z.enum(EDITABLE_ROLES),
  password,
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { message: "The two passwords don't match", path: ["confirm"] });

/** A new staff login (User or Admin). */
export async function createUser(_: ActionResult, form: FormData): Promise<ActionResult> {
  const me = await authorize("Access.Manage");
  const parsed = newUserSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: i.message, fieldErrors: { [String(i.path[0])]: i.message } };
  }
  const v = parsed.data;
  if (await db.user.findFirst({ where: { username: v.username } })) return { ok: false, error: "That username is taken", fieldErrors: { username: "Taken" } };
  const hash = await hashPassword(v.password);
  await db.$transaction(async (tx) => {
    const id = `usr_${randomUUID()}`;
    await tx.user.create({ data: { id, name: v.name, email: `${v.username}@ipower.local`, emailVerified: true, username: v.username, displayUsername: v.username, role: v.role, tenantId: me.tenantId } });
    await tx.authAccount.create({ data: { id: `acc_${randomUUID()}`, accountId: id, providerId: "credential", userId: id, password: hash } });
    await audit(tx, me, { entity: "User", entityId: id, action: "Created", summary: `Login ${v.username} (${v.name}) created as ${ROLE_LABEL[v.role]}` });
  });
  revalidatePath("/settings/users");
  return { ok: true, message: `${v.name} can now sign in as ${v.username}` };
}

const updateSchema = z.object({ userId: z.string().min(1), role: z.enum(EDITABLE_ROLES), active: z.enum(["on", "off"]) });

/** Change a staff member's role, or switch their login off (signs them out) / on. The owner's login can't be changed here. */
export async function updateUser(_: ActionResult, form: FormData): Promise<ActionResult> {
  const me = await authorize("Access.Manage");
  const parsed = updateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: "Reload the page and try again" };
  const { userId, role, active } = parsed.data;
  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const u = await tx.user.findFirst({ where: { id: userId, tenantId: me.tenantId, deletedAt: null } });
    if (!u) return { ok: false, error: "User not found" };
    if (u.id === me.id || u.role === "SuperAdmin") return { ok: false, error: "The owner's own login can't be changed here" };
    const on = active === "on";
    if (u.role === role && u.active === on) return { ok: true, message: "No changes" };
    await tx.user.update({ where: { id: u.id }, data: { role, active: on } });
    if (!on) await tx.session.deleteMany({ where: { userId: u.id } });
    await audit(tx, me, {
      entity: "User", entityId: u.id, action: "Updated", summary: `${u.name} (${u.username})`,
      before: { role: ROLE_LABEL[u.role], login: u.active ? "on" : "off" }, after: { role: ROLE_LABEL[role], login: on ? "on" : "off" },
    });
    return { ok: true, message: `${u.name} updated` };
  });
  revalidatePath("/settings/users");
  return result;
}

const passwordSchema = z.object({ userId: z.string().min(1), password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "The two passwords don't match", path: ["confirm"] });

/** Set a new password for a login (the person is signed out everywhere, unless it is your own). */
export async function setUserPassword(_: ActionResult, form: FormData): Promise<ActionResult> {
  const me = await authorize("Access.Manage");
  const parsed = passwordSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: i.message, fieldErrors: { [String(i.path[0])]: i.message } };
  }
  const { userId } = parsed.data;
  const u = await db.user.findFirst({ where: { id: userId, tenantId: me.tenantId, deletedAt: null } });
  if (!u) return { ok: false, error: "User not found" };
  const hash = await hashPassword(parsed.data.password);
  await db.$transaction(async (tx) => {
    const n = await tx.authAccount.updateMany({ where: { userId: u.id, providerId: "credential" }, data: { password: hash } });
    if (!n.count) await tx.authAccount.create({ data: { id: `acc_${randomUUID()}`, accountId: u.id, providerId: "credential", userId: u.id, password: hash } });
    if (u.id !== me.id) await tx.session.deleteMany({ where: { userId: u.id } });
    await audit(tx, me, { entity: "User", entityId: u.id, action: "Password", summary: `New password set for ${u.name} (${u.username})` });
  });
  return { ok: true, message: `Password changed for ${u.name}` };
}

const deleteSchema = z.object({ userId: z.string().min(1), handOverTo: z.string().default(""), confirm: z.string() });

/**
 * Delete a staff login: their customers, leads, policies, proposals, quotations and open calls move to `handOverTo`;
 * the login can no longer be used (password and sessions removed, username freed) and they leave the Users list.
 * Their name stays on old receipts, Day Book entries and the change log. The owner's login can't be deleted.
 */
export async function deleteUser(_: ActionResult, form: FormData): Promise<ActionResult> {
  const me = await authorize("Access.Manage");
  const parsed = deleteSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: "Reload the page and try again" };
  const { userId, handOverTo } = parsed.data;
  if (parsed.data.confirm.trim().toUpperCase() !== "DELETE") return { ok: false, error: "Type DELETE to confirm", fieldErrors: { confirm: "Required" } };
  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const u = await tx.user.findFirst({ where: { id: userId, tenantId: me.tenantId, deletedAt: null } });
    if (!u) return { ok: false, error: "User not found" };
    if (u.id === me.id || u.role === "SuperAdmin") return { ok: false, error: "The owner's login can't be deleted" };
    const work = await ownedWork(tx, u.id);
    let to: { id: string; name: string } | null = null;
    if (work.total) {
      to = await tx.user.findFirst({ where: { id: handOverTo, tenantId: me.tenantId, active: true, deletedAt: null, NOT: { id: u.id } }, select: { id: true, name: true } });
      if (!to) return { ok: false, error: "Pick who takes over their customers and leads", fieldErrors: { handOverTo: "Required" } };
      const move = { ownerId: to.id };
      await tx.customer.updateMany({ where: { ownerId: u.id }, data: move });
      await tx.lead.updateMany({ where: { ownerId: u.id }, data: move });
      await tx.call.updateMany({ where: { ownerId: u.id, outcome: null }, data: move });
      await tx.policy.updateMany({ where: { ownerId: u.id }, data: move });
      await tx.proposal.updateMany({ where: { ownerId: u.id }, data: move });
      await tx.quotation.updateMany({ where: { ownerId: u.id }, data: move });
    }
    await tx.session.deleteMany({ where: { userId: u.id } });
    await tx.authAccount.deleteMany({ where: { userId: u.id } });
    await tx.user.update({
      where: { id: u.id },
      data: { active: false, deletedAt: new Date(), username: null, displayUsername: null, email: `deleted-${u.id}@ipower.local` },
    });
    await audit(tx, me, {
      entity: "User", entityId: u.id, action: "Deleted",
      summary: `Login ${u.username} (${u.name}) deleted${to ? ` · handed over to ${to.name}: ${work.customers} customers, ${work.leads} leads, ${work.policies} policies, ${work.proposals} proposals, ${work.quotations} quotations, ${work.calls} open calls` : ""}`,
    });
    return { ok: true, message: `${u.name} deleted${to ? `; their work is now with ${to.name}` : ""}` };
  });
  revalidatePath("/settings/users");
  return result;
}
