import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { ROLE_LABEL } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { SettingsTabs } from "../settings-tabs";
import { ownedWork } from "@/lib/users";
import { DeleteUserButton, NewUserForm, PasswordForm, UserRowForm } from "./user-forms";

/** Settings → Users (Super Admin only): logins (User, Admin, Super Admin), their role, login on / off, new passwords. */
export default async function UsersPage() {
  const me = await requirePermission("Access.Manage");
  const users = await db.user.findMany({ where: { tenantId: me.tenantId, deletedAt: null }, orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }] });
  const work = new Map(await Promise.all(users.map(async (u) => [u.id, await ownedWork(db, u.id)] as const)));
  const handOver = (id: string) => users.filter((u) => u.active && u.id !== id).map((u) => ({ id: u.id, label: `${u.name} (${ROLE_LABEL[u.role]})` }));
  return (
    <>
      <PageHeader title="Settings" user={me} />
      <SettingsTabs active="users" />
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 rounded-xl border bg-white p-4">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Role / login</TableHead><TableHead>Last sign-in</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} className={u.active ? "" : "text-muted-foreground"}>
                  <TableCell>{u.name}{!u.active && <StatusBadge tone="slate">Login off</StatusBadge>}</TableCell>
                  <TableCell className="font-mono text-xs">{u.username}</TableCell>
                  <TableCell>
                    {u.id === me.id
                      ? <span>{ROLE_LABEL[u.role]} <span className="text-xs text-muted-foreground">(your own login – can&apos;t be changed here)</span></span>
                      : <UserRowForm userId={u.id} role={u.role} active={u.active} />}
                  </TableCell>
                  <TableCell className="text-sm">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <PasswordForm userId={u.id} />
                      {u.id !== me.id && <DeleteUserButton userId={u.id} name={u.name} work={work.get(u.id)!} others={handOver(u.id)} />}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            What each role may do is set under Roles and access. Switching a login off signs the person out at once; their records stay.
            Setting a new password signs the person out everywhere. Deleting a login hands their customers and leads to someone else first. All changes are in the change log.
          </p>
        </div>
        <div className="w-80 shrink-0"><NewUserForm /></div>
      </div>
    </>
  );
}
