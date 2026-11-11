"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { DmyDateInput } from "@/components/dmy-date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { submitKeepingValues } from "@/lib/form";
import { cancelCommission, recordCommission } from "./actions";

/** Record commission received: source, for month, amount, bank account, UTR (required), date received, note. */
export function CommissionForm({ sources, banks, month, today }: { sources: string[]; banks: { id: string; label: string }[]; month: string; today: string }) {
  const [key, setKey] = useState(0);
  const [source, setSource] = useState(sources[0] ?? "Other");
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await recordCommission(prev, form);
    if (r.ok) {
      toast.success("Commission recorded");
      setKey((k) => k + 1);
    }
    return r;
  }, { ok: false });
  const err = state.fieldErrors ?? {};
  return (
    <form key={key} onSubmit={submitKeepingValues(action)} className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">Record commission received</h2>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cm-source">Source</Label>
          <NativeSelect id="cm-source" name="source" value={source} onChange={(e) => setSource(e.target.value)} className="w-full">
            {sources.map((s) => <NativeSelectOption key={s} value={s}>{s}</NativeSelectOption>)}
            <NativeSelectOption value="Other">Other</NativeSelectOption>
          </NativeSelect>
        </div>
        {source === "Other"
          ? <div className="space-y-1.5"><Label htmlFor="cm-other">Source name</Label><Input id="cm-other" name="otherSource" aria-invalid={!!err.otherSource} /></div>
          : <input type="hidden" name="otherSource" value="" />}
        <div className="space-y-1.5"><Label htmlFor="cm-month">For month</Label><Input id="cm-month" name="forMonth" type="month" defaultValue={month} max={month} aria-invalid={!!err.forMonth} /></div>
        <div className="space-y-1.5"><Label htmlFor="cm-amount">Amount</Label><Input id="cm-amount" name="amount" inputMode="decimal" aria-invalid={!!err.amount} /></div>
        <div className="space-y-1.5">
          <Label htmlFor="cm-account">Received into</Label>
          <NativeSelect id="cm-account" name="accountId" defaultValue={banks[0]?.id ?? ""} className="w-full" aria-invalid={!!err.accountId}>
            {banks.map((b) => <NativeSelectOption key={b.id} value={b.id}>{b.label}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <div className="space-y-1.5"><Label htmlFor="cm-ref">UTR / transaction no.</Label><Input id="cm-ref" name="reference" aria-invalid={!!err.reference} /></div>
        <div className="space-y-1.5"><Label htmlFor="cm-date">Date received</Label><DmyDateInput id="cm-date" name="receivedOn" defaultValue={today} max={today} aria-invalid={!!err.receivedOn} /></div>
        <div className="space-y-1.5"><Label htmlFor="cm-note">Note</Label><Input id="cm-note" name="note" /></div>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save commission"}</Button>
      <p className="text-xs text-muted-foreground">Kept in this owner-only ledger, not in the Day Book: bank balances Admins see leave it out. Counted in P&amp;L for the month it is for.</p>
    </form>
  );
}

export function CancelCommission({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await cancelCommission(prev, form);
    if (r.ok) toast.success("Cancelled");
    return r;
  }, { ok: false });
  if (!open) return <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(true)}>Cancel…</Button>;
  return (
    <form onSubmit={submitKeepingValues(action)} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <Input name="reason" className="h-7 w-32" aria-label="Cancel reason" />
      <Button type="submit" size="xs" variant="destructive" disabled={pending}>Cancel entry</Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
