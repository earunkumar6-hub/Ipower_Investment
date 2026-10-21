"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CashDenominationGrid, paise } from "@/components/cash-denomination-grid";
import { submitKeepingValues } from "@/lib/form";
import { recordOwnerPaid, returnToOwner } from "./actions";

type Option = { id: string; label: string };

export function OwnerPaidForm({ items }: { items: Option[] }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await recordOwnerPaid(prev, form);
    if (r.ok) toast.success("Owner-paid slip saved");
    return r;
  }, { ok: false });

  return (
    <form onSubmit={submitKeepingValues(action)} className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">Record owner-paid bill</h2>
      <div className="space-y-1.5">
        <Label htmlFor="renewalItemId">Bill</Label>
        <NativeSelect id="renewalItemId" name="renewalItemId" className="w-full" defaultValue="">
          <NativeSelectOption value="">Pick the bill</NativeSelectOption>
          {items.map((i) => <NativeSelectOption key={i.id} value={i.id}>{i.label}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="poReceiptNo">Reference no. (required)</Label>
        <Input id="poReceiptNo" name="poReceiptNo" placeholder="PO receipt no. or insurer txn no." />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save owner-paid slip"}</Button>
    </form>
  );
}

export function ReturnToOwnerForm({ slips }: { slips: (Option & { amount: string })[] }) {
  const [slipId, setSlipId] = useState("");
  const [mode, setMode] = useState("Cash");
  const slip = slips.find((s) => s.id === slipId);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await returnToOwner(prev, form);
    if (r.ok) toast.success("Returned to owner; Day Book updated");
    return r;
  }, { ok: false });

  return (
    <form onSubmit={submitKeepingValues(action)} className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">Return to owner</h2>
      <div className="space-y-1.5">
        <Label htmlFor="slipId">Slip</Label>
        <NativeSelect id="slipId" name="slipId" className="w-full" value={slipId} onChange={(e) => setSlipId(e.target.value)}>
          <NativeSelectOption value="">{slips.length ? "Pick a slip" : "Nothing to return"}</NativeSelectOption>
          {slips.map((s) => <NativeSelectOption key={s.id} value={s.id}>{s.label}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="mode">Returned by</Label>
        <NativeSelect id="mode" name="mode" className="w-full" value={mode} onChange={(e) => setMode(e.target.value)}>
          <NativeSelectOption value="Cash">Cash</NativeSelectOption>
          <NativeSelectOption value="Bank">Bank transfer</NativeSelectOption>
        </NativeSelect>
      </div>
      {mode === "Cash" && slip && <CashDenominationGrid amount={paise(slip.amount)} idPrefix="ret" />}
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" variant="outline" disabled={pending || !slips.length} className="w-full">{pending ? "Saving…" : "Record return"}</Button>
      <p className="text-xs text-muted-foreground">Posts the money out of cash or bank in the Day Book and settles the slip.</p>
    </form>
  );
}
