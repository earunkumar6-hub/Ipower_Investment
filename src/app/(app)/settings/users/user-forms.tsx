"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { submitKeepingValues } from "@/lib/form";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { createUser, deleteUser, setUserPassword, updateUser } from "../access-actions";

const useSave = (fn: (p: ActionResult, f: FormData) => Promise<ActionResult>, done?: () => void) =>
  useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await fn(prev, form);
    if (r.ok) {
      toast.success(r.message ?? "Saved");
      done?.();
    }
    return r;
  }, { ok: false });

/** A new staff login. */
export function NewUserForm() {
  const [key, setKey] = useState(0);
  const [state, action, pending] = useSave(createUser, () => setKey((k) => k + 1));
  const err = state.fieldErrors ?? {};
  return (
    <form key={key} onSubmit={submitKeepingValues(action)} className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">Add a login</h2>
      <div className="space-y-1.5"><Label htmlFor="nu-name">Name</Label><Input id="nu-name" name="name" aria-invalid={!!err.name} /></div>
      <div className="space-y-1.5"><Label htmlFor="nu-username">Username</Label><Input id="nu-username" name="username" autoComplete="off" aria-invalid={!!err.username} /></div>
      <div className="space-y-1.5">
        <Label htmlFor="nu-role">Role</Label>
        <NativeSelect id="nu-role" name="role" defaultValue="User" className="w-full">
          <NativeSelectOption value="User">User</NativeSelectOption>
          <NativeSelectOption value="Admin">Admin</NativeSelectOption>
          <NativeSelectOption value="SuperAdmin">Super Admin</NativeSelectOption>
        </NativeSelect>
      </div>
      <div className="space-y-1.5"><Label htmlFor="nu-pw">Password (at least 8 characters)</Label><Input id="nu-pw" name="password" type="password" autoComplete="new-password" aria-invalid={!!err.password} /></div>
      <div className="space-y-1.5"><Label htmlFor="nu-pw2">Password again</Label><Input id="nu-pw2" name="confirm" type="password" autoComplete="new-password" aria-invalid={!!err.confirm} /></div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Add login"}</Button>
      <p className="text-xs text-muted-foreground">Give the person their username and password; they can sign in at once. A Super Admin can do everything, including changing other logins.</p>
    </form>
  );
}

/** Role and login on / off for one staff member. */
export function UserRowForm({ userId, role, active }: { userId: string; role: "Admin" | "User" | "SuperAdmin"; active: boolean }) {
  const [state, action, pending] = useSave(updateUser);
  return (
    <form onSubmit={submitKeepingValues(action)} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <NativeSelect name="role" defaultValue={role} aria-label="Role" className="h-7">
        <NativeSelectOption value="User">User</NativeSelectOption>
        <NativeSelectOption value="Admin">Admin</NativeSelectOption>
        <NativeSelectOption value="SuperAdmin">Super Admin</NativeSelectOption>
      </NativeSelect>
      <NativeSelect name="active" defaultValue={active ? "on" : "off"} aria-label="Login" className="h-7">
        <NativeSelectOption value="on">Login on</NativeSelectOption>
        <NativeSelectOption value="off">Login off</NativeSelectOption>
      </NativeSelect>
      <Button type="submit" size="xs" variant="outline" disabled={pending}>Save</Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}

/** Set a new password for a login. */
export function PasswordForm({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useSave(setUserPassword, () => setOpen(false));
  if (!open) return <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(true)}>Set password…</Button>;
  return (
    <form onSubmit={submitKeepingValues(action)} className="flex items-center gap-1">
      <input type="hidden" name="userId" value={userId} />
      <Input name="password" type="password" autoComplete="new-password" className="h-7 w-32" aria-label="New password" />
      <Input name="confirm" type="password" autoComplete="new-password" className="h-7 w-24" aria-label="New password again" />
      <Button type="submit" size="xs" disabled={pending} className="bg-brand-600 hover:bg-brand-700">Set</Button>
      <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}

type Work = { customers: number; leads: number; calls: number; policies: number; proposals: number; quotations: number; total: number };

/** Delete a login: pick who takes over their work, type DELETE. Their name stays on old records. */
export function DeleteUserButton({ userId, name, work, others }: { userId: string; name: string; work: Work; others: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useSave(deleteUser, () => setOpen(false));
  const err = state.fieldErrors ?? {};
  const owned = [["customers", work.customers], ["leads", work.leads], ["policies", work.policies], ["proposals", work.proposals], ["quotations", work.quotations], ["open calls", work.calls]]
    .filter(([, n]) => Number(n) > 0).map(([k, n]) => `${n} ${k}`).join(", ");
  return (
    <>
      <Button type="button" size="xs" variant="ghost" className="text-destructive" onClick={() => setOpen(true)}>Delete…</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="text-lg font-semibold">Delete {name}&apos;s login?</DialogTitle>
          <DialogDescription>
            The login is removed for good and {name} leaves this list. Their name stays on old receipts, Day Book entries and the change log.
            To let them back in later, switch the login off instead.
          </DialogDescription>
          <form onSubmit={submitKeepingValues(action)} className="space-y-3">
            <input type="hidden" name="userId" value={userId} />
            {work.total > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="du-to">{name} has {owned}. Hand them over to</Label>
                <NativeSelect id="du-to" name="handOverTo" defaultValue="" className="w-full" aria-invalid={!!err.handOverTo}>
                  <NativeSelectOption value=""></NativeSelectOption>
                  {others.map((o) => <NativeSelectOption key={o.id} value={o.id}>{o.label}</NativeSelectOption>)}
                </NativeSelect>
              </div>
            ) : <p className="text-sm text-muted-foreground">{name} has no customers, leads or open calls to hand over.</p>}
            <div className="space-y-1.5">
              <Label htmlFor="du-confirm">Type DELETE to confirm</Label>
              <Input id="du-confirm" name="confirm" autoComplete="off" aria-invalid={!!err.confirm} />
            </div>
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={pending}>{pending ? "Deleting…" : "Delete login"}</Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
