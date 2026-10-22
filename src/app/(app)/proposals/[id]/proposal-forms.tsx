"use client";

import { useActionState, useState } from "react";
import { useConfirmBeforeSave } from "@/components/confirm-save";
import { DuplicateCustomerDialog } from "@/components/duplicate-customer-dialog";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { submitKeepingValues } from "@/lib/form";
import { issuePolicy, savePolicyDetails, saveKyc } from "../actions";

export function KycForm({ proposalId, unlocked, panMasked, aadhaarLast4, consent }: {
  proposalId: string; unlocked: boolean; panMasked: string | null; aadhaarLast4: string | null;
  /** "Customer consent taken" already recorded: "By R. Murali, 22 Oct 2026". */
  consent: string | null;
}) {
  const [ticked, setTicked] = useState(!!consent);
  const [dup, setDup] = useState<ActionResult["duplicate"]>();
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await saveKyc(prev, form);
    if (r.ok) toast.success(r.message ?? "Aadhaar and PAN saved (masked)");
    setDup(r.duplicate);
    return r;
  }, { ok: false });
  const open = unlocked && ticked;

  return (
    <form onSubmit={submitKeepingValues(action)} className="space-y-3">
      <input type="hidden" name="proposalId" value={proposalId} />
      <label className="flex items-start gap-2 text-sm font-medium">
        <input type="checkbox" name="consent" checked={ticked} disabled={!!consent || !unlocked} onChange={(e) => setTicked(e.target.checked)} className="mt-0.5" />
        <span>Customer consent taken{consent && <span className="block text-xs font-normal text-muted-foreground">{consent}</span>}</span>
      </label>
      <div className="space-y-1.5">
        <Label htmlFor="aadhaar">Aadhaar</Label>
        <Input id="aadhaar" name="aadhaar" readOnly={!open} disabled={!open} inputMode="numeric" maxLength={14}
          placeholder={aadhaarLast4 ? `XXXX-XXXX-${aadhaarLast4}` : unlocked ? "12 digits (optional)" : "Not entered"} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pan">PAN</Label>
        <Input id="pan" name="pan" readOnly={!open} disabled={!open} maxLength={10} className="not-placeholder-shown:uppercase"
          placeholder={panMasked ?? (unlocked ? "ABCDE1234F (optional)" : "Not entered")} />
      </div>
      <p className="rounded-lg bg-slate-100 p-2 text-xs text-slate-700">
        Optional; needs the consent tick. Stored encrypted, shown masked (PAN ABCxxxxx4M, Aadhaar last 4). A number that already belongs to another customer is refused.{!unlocked && " The policy is issued; they can't be changed here."}
      </p>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {unlocked && (
        <Button type="submit" variant="outline" disabled={pending} className="w-full">
          {pending ? "Saving…" : "Save Aadhaar / PAN"}
        </Button>
      )}
      <DuplicateCustomerDialog duplicate={dup} onClose={() => setDup(undefined)} />
    </form>
  );
}

export function IssuePolicyForm({ proposalId, ready, waitingFor }: { proposalId: string; ready: boolean; waitingFor: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await issuePolicy(prev, form);
    if (r.ok) toast.success("Policy issued; customer and renewals created");
    return r;
  }, { ok: false });

  return (
    <form onSubmit={submitKeepingValues(action)} className="flex flex-wrap items-end gap-2 border-t pt-4">
      <input type="hidden" name="proposalId" value={proposalId} />
      <div className="space-y-1.5">
        <Label htmlFor="policyNumber">Policy number (leave blank until issued)</Label>
        <Input id="policyNumber" name="policyNumber" className="w-64 not-placeholder-shown:uppercase" disabled={!ready} placeholder={ready ? "e.g. STAR-P-700123" : waitingFor} />
      </div>
      <Button type="submit" disabled={!ready || pending} className="bg-brand-600 hover:bg-brand-700">
        {pending ? "Issuing…" : "Save policy number"}
      </Button>
      {state.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

type Option = { id: string; name: string; tenureMonths: number | null };

/** Pay mode, term, start date, premium paying term (and scheme, when the product has several). */
export function PolicyDetailsForm({ proposalId, payModes, schemes, initial, showPpt }: {
  proposalId: string; payModes: { value: string; label: string }[]; schemes: Option[]; showPpt: boolean;
  initial: { frequency: string; term: string; ppt: string; startDate: string; schemeId: string };
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await savePolicyDetails(prev, form);
    if (r.ok) toast.success("Policy details saved");
    return r;
  }, { ok: false });
  // Save at the top and the bottom: both open the same check-before-saving pop-up.
  const confirm = useConfirmBeforeSave(action, (form) => [
    ["Scheme / plan", schemes.find((s) => s.id === form.get("schemeId"))?.name ?? ""],
    ["Pay mode", payModes.find((m) => m.value === form.get("frequency"))?.label ?? ""],
    ["Term", form.get("term") ? `${form.get("term")} years` : ""],
    ["Premium paying term", form.get("premiumPayingTerm") ? `${form.get("premiumPayingTerm")} years` : ""],
    ["Start date", String(form.get("startDate") ?? "")],
  ]);
  const saveButton = <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save details"}</Button>;
  return (
    <form onSubmit={confirm.onSubmit} className="grid grid-cols-5 items-end gap-2">
      <input type="hidden" name="proposalId" value={proposalId} />
      <div className="col-span-5 flex justify-end">{saveButton}</div>
      {schemes.length > 0 ? (
        <div className="space-y-1.5">
          <Label htmlFor="schemeId">Scheme / plan</Label>
          <NativeSelect id="schemeId" name="schemeId" defaultValue={initial.schemeId} className="w-full">
            <NativeSelectOption value="">Pick</NativeSelectOption>
            {schemes.map((s) => <NativeSelectOption key={s.id} value={s.id}>{s.name}</NativeSelectOption>)}
          </NativeSelect>
        </div>
      ) : <input type="hidden" name="schemeId" value="" />}
      <div className="space-y-1.5">
        <Label htmlFor="frequency">Pay mode</Label>
        <NativeSelect id="frequency" name="frequency" defaultValue={initial.frequency} className="w-full">
          <NativeSelectOption value="">Pick</NativeSelectOption>
          {payModes.map((m) => <NativeSelectOption key={m.value} value={m.value}>{m.label}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="space-y-1.5"><Label htmlFor="term">Term (years)</Label><Input id="term" name="term" inputMode="decimal" defaultValue={initial.term} placeholder="e.g. 5" /></div>
      {showPpt
        ? <div className="space-y-1.5"><Label htmlFor="premiumPayingTerm">Premium paying term (years)</Label><Input id="premiumPayingTerm" name="premiumPayingTerm" inputMode="decimal" defaultValue={initial.ppt} /></div>
        : <input type="hidden" name="premiumPayingTerm" value="" />}
      <div className="space-y-1.5"><Label htmlFor="startDate">Start date</Label><Input id="startDate" name="startDate" type="date" defaultValue={initial.startDate} /></div>
      {saveButton}
      {state.error && <p className="col-span-5 text-sm text-destructive">{state.error}</p>}
      {confirm.dialog}
    </form>
  );
}
