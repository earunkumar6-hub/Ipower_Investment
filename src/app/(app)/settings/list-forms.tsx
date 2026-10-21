"use client";

import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitKeepingValues } from "@/lib/form";
import { addCustomerBank, addDropdownValue, saveGraceDays, setDropdownActive, setPayOptionActive } from "./money-actions";

/** On / off switch for a payment mode, customer bank or dropdown value. */
export function ToggleButton({ kind, id, active }: { kind: "payOption" | "dropdown"; id: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
      const r = kind === "payOption" ? await setPayOptionActive(id, !active) : await setDropdownActive(id, !active);
      if (r.ok) toast.success(active ? "Switched off" : "Switched on");
      else toast.error(r.error ?? "Could not save");
    })}>
      {active ? (kind === "dropdown" ? "Remove" : "Switch off") : (kind === "dropdown" ? "Bring back" : "Switch on")}
    </Button>
  );
}

function OneFieldForm({ label, name, placeholder, submit, hidden, action: serverAction, done }: {
  label: string; name: string; placeholder?: string; submit: string; hidden?: Record<string, string>;
  action: (prev: ActionResult, form: FormData) => Promise<ActionResult>; done: string;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await serverAction(prev, form);
    if (r.ok) toast.success(done);
    return r;
  }, { ok: false });
  return (
    <form onSubmit={submitKeepingValues(action)} className="space-y-2">
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Label htmlFor={name}>{label}</Label>
      <div className="flex gap-2">
        <Input id={name} name={name} placeholder={placeholder} aria-invalid={!!state.error} />
        <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : submit}</Button>
      </div>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}

export const AddCustomerBankForm = () => (
  <OneFieldForm label="Add a bank to the list" name="name" placeholder="e.g. Karur Vysya Bank" submit="Add" action={addCustomerBank} done="Bank added" />
);

export const AddDropdownValueForm = ({ list, label }: { list: string; label: string }) => (
  <OneFieldForm label={label} name="value" submit="Add" hidden={{ list }} action={addDropdownValue} done="Added" />
);

export function GraceDaysForm({ value }: { value: number }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await saveGraceDays(prev, form);
    if (r.ok) toast.success("Saved");
    return r;
  }, { ok: false });
  return (
    <form onSubmit={submitKeepingValues(action)} className="space-y-2">
      <Label htmlFor="graceDays">Grace period to close a day (days)</Label>
      <div className="flex gap-2">
        <Input id="graceDays" name="graceDays" inputMode="numeric" defaultValue={value} className="w-24" aria-invalid={!!state.error} />
        <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save"}</Button>
      </div>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
