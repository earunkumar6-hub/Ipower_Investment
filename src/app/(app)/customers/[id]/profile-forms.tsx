"use client";

import { useActionState, useRef, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { scheduleCall } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitKeepingValues } from "@/lib/form";
import { changeCustomerPhoto } from "../actions";

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
export function AddFollowUpForm({ customerId, today }: { customerId: string; today: string }) {
  const [key, setKey] = useState(0);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await scheduleCall(prev, form);
    if (r.ok) {
      toast.success("Follow-up added");
      setKey((k) => k + 1);
    }
    return r;
  }, { ok: false });
  return (
    <form key={key} onSubmit={submitKeepingValues(action)} className="mt-3 grid grid-cols-[auto_auto_1fr_auto] items-end gap-2 rounded-lg border border-dashed p-2">
      <input type="hidden" name="kind" value="customer" />
      <input type="hidden" name="refId" value={customerId} />
      <div className="space-y-1"><Label htmlFor="fu-date" className="text-xs">Date</Label><Input id="fu-date" name="callDate" type="date" min={today} defaultValue={today} className="h-8" /></div>
      <div className="space-y-1"><Label htmlFor="fu-time" className="text-xs">Time</Label><Input id="fu-time" name="callTime" type="time" className="h-8" /></div>
      <div className="space-y-1"><Label htmlFor="fu-note" className="text-xs">Notes</Label><Input id="fu-note" name="note" placeholder="What to discuss" className="h-8" /></div>
      <Button type="submit" size="sm" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Adding…" : "Add follow-up"}</Button>
      {state.error && <p className="col-span-4 text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
