"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { resetRoleAccess, saveRoleAccess } from "../access-actions";

/** `allowed` now; `def` = the built-in rule. */
type Cell = { allowed: boolean; def: boolean };
type Row = { permission: string; label: string; locked: boolean; admin: Cell; user: Cell };

/** Tick boxes for Admin and User per permission; the Super Admin column is always ticked. Changed boxes are marked. */
export function RoleGrid({ groups }: { groups: { area: string; rows: Row[] }[] }) {
  const initial = Object.fromEntries(groups.flatMap((g) => g.rows).flatMap((r) => [[`Admin:${r.permission}`, r.admin.allowed], [`User:${r.permission}`, r.user.allowed]]));
  const [grid, setGrid] = useState<Record<string, boolean>>(initial);
  const [resetting, startReset] = useTransition();
  const [, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await saveRoleAccess(prev, form);
    if (r.ok) toast.success(r.message ?? "Saved");
    else toast.error(r.error ?? "Could not save");
    return r;
  }, { ok: false });
  const dirty = Object.keys(grid).some((k) => grid[k] !== initial[k]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const rows = Object.entries(grid).map(([k, allowed]) => {
      const [role, permission] = k.split(":");
      return { role, permission, allowed };
    });
    const f = new FormData();
    f.set("grid", JSON.stringify(rows));
    startTransition(() => action(f));
  }

  const box = (role: "Admin" | "User", r: Row) => {
    const key = `${role}:${r.permission}`;
    const changed = grid[key] !== (role === "Admin" ? r.admin : r.user).def; // differs from the built-in rule
    return (
      <TableCell className={cn("text-center", changed && "bg-saffron-50")}>
        <input type="checkbox" aria-label={`${role}: ${r.label}`} checked={grid[key]} disabled={r.locked}
          onChange={(e) => setGrid({ ...grid, [key]: e.target.checked })} />
        {changed && <span className="ml-1 text-xs text-saffron-800">not default</span>}
      </TableCell>
    );
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow><TableHead>Permission</TableHead><TableHead className="w-32 text-center">Super Admin</TableHead><TableHead className="w-32 text-center">Admin</TableHead><TableHead className="w-32 text-center">User</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {groups.flatMap((g) => [
            <TableRow key={g.area} className="bg-slate-50 hover:bg-slate-50"><TableCell colSpan={4} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.area}</TableCell></TableRow>,
            ...g.rows.map((r) => (
              <TableRow key={r.permission}>
                <TableCell>{r.label}{r.locked && <span className="ml-1 text-xs text-muted-foreground">(fixed)</span>}</TableCell>
                <TableCell className="text-center"><input type="checkbox" checked disabled aria-label={`Super Admin: ${r.label}`} /></TableCell>
                {box("Admin", r)}
                {box("User", r)}
              </TableRow>
            )),
          ])}
        </TableBody>
      </Table>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending || !dirty} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save access"}</Button>
        <Button type="button" variant="outline" disabled={resetting}
          onClick={() => startReset(async () => { const r = await resetRoleAccess(); toast.success(r.message ?? "Reset"); setGrid(initial); location.reload(); })}>
          Reset to defaults
        </Button>
        {dirty && <span className="text-xs text-saffron-800">Unsaved changes</span>}
      </div>
    </form>
  );
}
