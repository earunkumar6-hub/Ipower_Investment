"use client";

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { DmyDateInput } from "@/components/dmy-date-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitKeepingValues } from "@/lib/form";
import { deleteServiceRate, saveServiceRate } from "./actions";

/**
 * A new rate for one service, with the date it starts. Slab services (EB) take a bill range and the charge added to
 * the bill; fixed services (PAN, certificate) take the amount paid / deducted and the amount collected.
 */
export function RateForm({ serviceTypeId, slab, today }: { serviceTypeId: string; slab: boolean; today: string }) {
  const [key, setKey] = useState(0);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await saveServiceRate(prev, form);
    if (r.ok) {
      toast.success("Rate saved");
      setKey((k) => k + 1);
    }
    return r;
  }, { ok: false });
  const err = state.fieldErrors ?? {};
  const p = `rate-${serviceTypeId}`;
  const box = (name: string, label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`${p}-${name}`}>{label}</Label>
      <Input id={`${p}-${name}`} name={name} inputMode="decimal" aria-invalid={!!err[name]} />
    </div>
  );
  return (
    <form key={key} onSubmit={submitKeepingValues(action)} className="space-y-3 rounded-lg border bg-slate-50/60 p-3">
      <input type="hidden" name="serviceTypeId" value={serviceTypeId} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {slab ? (
          <>
            {box("minAmount", "Bill amount from (₹)")}
            {box("maxAmount", "Bill amount to (₹)")}
            {box("serviceCharge", "Service charge (₹)")}
          </>
        ) : (
          <>
            {box("walletCost", "Amount paid / deducted (₹)")}
            {box("fixedCustomerAmount", "Collected from customer (₹)")}
          </>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`${p}-from`}>Starts on</Label>
          <DmyDateInput id={`${p}-from`} name="effectiveFrom" defaultValue={today} aria-invalid={!!err.effectiveFrom} />
        </div>
      </div>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : slab ? "Save slab rate" : "Save rate"}</Button>
    </form>
  );
}

/** Remove a rate that has not started yet. */
export function DeleteRateButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
      const r = await deleteServiceRate(id);
      if (r.ok) toast.success("Rate removed");
      else toast.error(r.error ?? "Could not remove");
    })}>Remove</Button>
  );
}
