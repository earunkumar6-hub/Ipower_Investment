import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { isDefaultAllowed, LOCKED_PERMISSIONS, PERMISSION_GROUPS } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { SettingsTabs } from "../settings-tabs";
import { RoleGrid } from "./role-grid";

/** Settings → Roles and access (Super Admin only): what Admins and Users may do. */
export default async function RolesPage() {
  const user = await requirePermission("Access.Manage");
  const saved = await db.rolePermission.findMany({ where: { tenantId: user.tenantId } });
  const cell = (role: "Admin" | "User", p: (typeof PERMISSION_GROUPS)[number]["items"][number][0]) => ({
    allowed: saved.find((r) => r.role === role && r.permission === p)?.allowed ?? isDefaultAllowed(role, p),
    def: isDefaultAllowed(role, p),
  });
  const groups = PERMISSION_GROUPS.map((g) => ({
    area: g.area,
    rows: g.items.map(([permission, label]) => ({ permission, label, locked: LOCKED_PERMISSIONS.includes(permission), admin: cell("Admin", permission), user: cell("User", permission) })),
  }));
  return (
    <>
      <PageHeader title="Settings" user={user} />
      <SettingsTabs active="roles" />
      <div className="max-w-4xl rounded-xl border bg-white p-4">
        <h2 className="mb-1 font-semibold">Roles and access</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Tick what Admins and Users may do. Changes apply at once to every login with that role, on screens and on the server.
          The Super Admin always has everything. Boxes marked &quot;not default&quot; differ from the built-in rules; every change is in the change log.
        </p>
        <RoleGrid groups={groups} />
      </div>
    </>
  );
}
