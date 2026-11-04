"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { scheduleCall, type ActionResult } from "@/app/(app)/leads/actions";
import { openCallReminder } from "@/components/call-reminder";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { submitKeepingValues } from "@/lib/form";
import type { ScheduleOptions } from "@/lib/followups";

const KINDS = [["lead", "Lead"], ["policy", "Renewal"], ["proposal", "Proposal"]] as const;
const tomorrowIst = () => new Date(Date.now() + 5.5 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);

/** Book a call about a lead, a renewal or a proposal; it goes to that record's owner. */
export function ScheduleCallButton({ options }: { options: ScheduleOptions }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>("lead");
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await scheduleCall(prev, form);
    if (r.ok) {
      toast.success("Call scheduled");
      setOpen(false);
    }
    return r;
  }, { ok: false });
  const err = state.fieldErrors ?? {};
  const list = options[kind];

  return (
    <>
      <Button onClick={() => setOpen(true)} className="bg-brand-600 hover:bg-brand-700">Schedule call</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="text-lg font-semibold">Schedule call</DialogTitle>
          <form onSubmit={submitKeepingValues(action)} className="space-y-3">
            <div className="space-y-1.5">
              <Label>For</Label>
              <div className="flex gap-2">
                {KINDS.map(([k, label]) => (
                  <label key={k} className="flex items-center gap-1.5 text-sm">
                    <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="accent-brand-600" /> {label}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="refId">{KINDS.find(([k]) => k === kind)![1]}</Label>
              <NativeSelect key={kind} id="refId" name="refId" defaultValue="" className="w-full" aria-invalid={!!err.refId}>
                <NativeSelectOption value="">{list.length ? "" : "Nothing to call about"}</NativeSelectOption>
                {list.map((o) => <NativeSelectOption key={o.id} value={o.id}>{o.label}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="sc-date">Date</Label><Input id="sc-date" name="callDate" type="date" defaultValue={tomorrowIst()} aria-invalid={!!err.callDate} /></div>
              <div className="space-y-1.5"><Label htmlFor="sc-time">Time</Label><Input id="sc-time" name="callTime" type="time" defaultValue="11:00" /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="sc-note">Note</Label><Textarea id="sc-note" name="note" rows={2} placeholder="e.g. Promised to pay by Friday" /></div>
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Schedule"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Opens the call reminder on this call to save its outcome. */
export function OpenCallButton({ callId }: { callId: string }) {
  return <Button type="button" size="xs" variant="outline" onClick={() => openCallReminder(callId)}>Open</Button>;
}
