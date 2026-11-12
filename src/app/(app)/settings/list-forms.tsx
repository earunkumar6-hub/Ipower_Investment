"use client";

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { submitKeepingValues } from "@/lib/form";
import { MODE_LABEL, RECEIPT_MODES } from "@/lib/payment-modes";
import { addDropdownValue, deletePayMode, saveGraceDays, savePayMode, setDropdownActive, setPayOptionActive } from "./money-actions";

/** On / off switch for a payment mode or dropdown value. */
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

function OneFieldForm({ label, name, submit, hidden, action: serverAction, done }: {
  label: string; name: string; submit: string; hidden?: Record<string, string>;
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
        <Input id={name} name={name} aria-invalid={!!state.error} />
        <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : submit}</Button>
      </div>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}

/** Add a pay mode, or (with `mode`) change one the agency added: its name and the built-in mode it works like (#28). */
export function PayModeForm({ mode, onDone }: { mode?: { id: string; name: string; base: string }; onDone?: () => void }) {
  const [key, setKey] = useState(0);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await savePayMode(prev, form);
    if (r.ok) {
      toast.success(mode ? "Pay mode changed" : "Pay mode added");
      setKey((k) => k + 1);
      onDone?.();
    }
    return r;
  }, { ok: false });
  const p = mode ? `pm-${mode.id}` : "pm-new";
  return (
    <form key={key} onSubmit={submitKeepingValues(action)} className="space-y-2">
      {mode && <input type="hidden" name="id" value={mode.id} />}
      <div className="space-y-1.5">
        <Label htmlFor={`${p}-name`}>Name</Label>
        <Input id={`${p}-name`} name="name" defaultValue={mode?.name} maxLength={30} aria-invalid={!!state.fieldErrors?.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${p}-base`}>Works like</Label>
        <NativeSelect id={`${p}-base`} name="base" defaultValue={mode?.base ?? ""} className="w-full" aria-invalid={!!state.fieldErrors?.base}>
          <NativeSelectOption value=""></NativeSelectOption>
          {RECEIPT_MODES.map((m) => <NativeSelectOption key={m} value={m}>{MODE_LABEL[m]}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : mode ? "Save" : "Add pay mode"}</Button>
        {mode && <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>}
      </div>
    </form>
  );
}

/** Change / Delete for a pay mode the agency added. Delete is refused by the server once a receipt uses the mode. */
export function PayModeRowActions({ mode }: { mode: { id: string; name: string; base: string } }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  if (editing) return <div className="w-64"><PayModeForm mode={mode} onDone={() => setEditing(false)} /></div>;
  return (
    <span className="flex gap-1">
      <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Change</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => {
        if (!window.confirm(`Delete the pay mode ${mode.name}?`)) return;
        start(async () => {
          const r = await deletePayMode(mode.id);
          if (r.ok) toast.success("Pay mode deleted");
          else toast.error(r.error ?? "Could not delete");
        });
      }}>Delete</Button>
    </span>
  );
}

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
