"use client";

import { useActionState, useRef, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { scheduleCall } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { DmyDateInput } from "@/components/dmy-date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitKeepingValues } from "@/lib/form";
import { DuplicateCustomerDialog } from "@/components/duplicate-customer-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { changeCustomerPhoto, saveCustomerIdentity } from "../actions";

/** Photo at the top of the customer record (initials when none), with "Change photo". */
export function CustomerPhoto({ customerId, name, initials, hasPhoto }: { customerId: string; name: string; initials: string; hasPhoto: boolean }) {
  const [shown, setShown] = useState(0); // bumps the image URL after a new photo is saved
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await changeCustomerPhoto(prev, form);
    if (r.ok) {
      toast.success("Photo saved");
      setShown(Date.now());
    } else toast.error(r.error ?? "Could not save the photo");
    return r;
  }, { ok: false });

  return (
    <form ref={formRef} onSubmit={submitKeepingValues(action)} className="flex shrink-0 flex-col items-center gap-1">
      <input type="hidden" name="customerId" value={customerId} />
      {hasPhoto
        // eslint-disable-next-line @next/next/no-img-element -- private route behind the owner check, not a static asset
        ? <img src={`/api/customers/${customerId}/photo${shown ? `?t=${shown}` : ""}`} alt={`Photo of ${name}`} className="size-20 rounded-full border object-cover" />
        : <div aria-label={`No photo – ${name}`} className="flex size-20 items-center justify-center rounded-full bg-brand-100 text-2xl font-semibold text-brand-700">{initials}</div>}
      <input ref={fileRef} type="file" name="photo" accept="image/jpeg,image/png" className="hidden" aria-label="Customer photo"
        onChange={() => fileRef.current?.files?.length && formRef.current?.requestSubmit()} />
      <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => fileRef.current?.click()}>{pending ? "Saving…" : "Change photo"}</Button>
      {state.error && <p className="max-w-28 text-center text-xs text-destructive">{state.error}</p>}
    </form>
  );
}

/** "Add follow-up" on the customer record: the call goes to the customer's owner and joins "calls open". */
export function AddFollowUpForm({ customerId, today, onDone }: { customerId: string; today: string; onDone?: () => void }) {
  const [key, setKey] = useState(0);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await scheduleCall(prev, form);
    if (r.ok) {
      toast.success("Follow-up added");
      setKey((k) => k + 1);
      onDone?.();
    }
    return r;
  }, { ok: false });
  return (
    <form key={key} onSubmit={submitKeepingValues(action)} className="mt-3 grid grid-cols-[auto_auto_1fr_auto] items-end gap-2 rounded-lg border border-dashed p-2">
      <input type="hidden" name="kind" value="customer" />
      <input type="hidden" name="refId" value={customerId} />
      <div className="space-y-1"><Label htmlFor="fu-date" className="text-xs">Date</Label><DmyDateInput id="fu-date" name="callDate" min={today} defaultValue={today} className="h-8" /></div>
      <div className="space-y-1"><Label htmlFor="fu-time" className="text-xs">Time</Label><Input id="fu-time" name="callTime" type="time" className="h-8" /></div>
      <div className="space-y-1"><Label htmlFor="fu-note" className="text-xs">Notes</Label><Input id="fu-note" name="note" placeholder="What to discuss" className="h-8" /></div>
      <Button type="submit" size="sm" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Adding…" : "Add follow-up"}</Button>
      {state.error && <p className="col-span-4 text-xs text-destructive">{state.error}</p>}
    </form>
  );
}

/** Aadhaar / PAN on the customer (#1, #13): consent tick first; full numbers encrypted; a duplicate opens the pop-up. */
export function IdentityButton({ customerId, consent, panMasked, aadhaarLast4 }: { customerId: string; consent: string | null; panMasked: string | null; aadhaarLast4: string | null }) {
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState(!!consent);
  const [dup, setDup] = useState<ActionResult["duplicate"]>();
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await saveCustomerIdentity(prev, form);
    setDup(r.duplicate);
    if (r.ok) {
      toast.success(r.message ?? "Aadhaar / PAN saved (encrypted, shown masked)");
      setOpen(false);
    }
    return r;
  }, { ok: false });
  return (
    <>
      <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(true)}>{panMasked || aadhaarLast4 ? "Change Aadhaar / PAN" : "Add Aadhaar / PAN"}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="text-lg font-semibold">Aadhaar and PAN</DialogTitle>
          <DialogDescription>Optional. Stored encrypted and shown masked. A number that already belongs to another customer is refused.</DialogDescription>
          <form onSubmit={submitKeepingValues(action)} className="space-y-3">
            <input type="hidden" name="customerId" value={customerId} />
            <label className="flex items-start gap-2 text-sm font-medium">
              <input type="checkbox" name="consent" checked={ticked} disabled={!!consent} onChange={(e) => setTicked(e.target.checked)} className="mt-0.5" />
              <span>Customer consent taken{consent && <span className="block text-xs font-normal text-muted-foreground">{consent}</span>}</span>
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="ci-aadhaar">Aadhaar</Label>
              <Input id="ci-aadhaar" name="aadhaar" disabled={!ticked} inputMode="numeric" maxLength={14} placeholder={aadhaarLast4 ? `XXXX-XXXX-${aadhaarLast4}` : "12 digits"} aria-invalid={!!state.fieldErrors?.aadhaar} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ci-pan">PAN</Label>
              <Input id="ci-pan" name="pan" disabled={!ticked} maxLength={10} className="not-placeholder-shown:uppercase" placeholder={panMasked ?? "ABCDE1234F"} aria-invalid={!!state.fieldErrors?.pan} />
            </div>
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            <Button type="submit" disabled={pending || !ticked} className="w-full bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save"}</Button>
          </form>
        </DialogContent>
      </Dialog>
      <DuplicateCustomerDialog duplicate={dup} onClose={() => setDup(undefined)} />
    </>
  );
}
