"use client";

import type { LeadStatus } from "@prisma/client";
import { usePathname, useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { toast } from "sonner";
import { useConfirmBeforeSave } from "@/components/confirm-save";
import { DmyDateInput } from "@/components/dmy-date-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { isoToDmy } from "@/lib/dates";
import { LEAD_STATUS_LABEL } from "@/lib/lead-labels";
import { createLead, editLead, type ActionResult } from "./actions";
import { EMPTY_LEAD, Field, LeadDetailFields, summarizeLead, type LeadDetails } from "./lead-fields";

const fmtCall = (form: FormData) => {
  const d = String(form.get("callDate") ?? ""), t = String(form.get("callTime") ?? "");
  if (!d) return "";
  const day = isoToDmy(d) || d;
  return t ? `${day}, ${new Date(`1970-01-01T${t}:00Z`).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" })}` : day;
};

/** `owners` is non-empty only for Admin / Super Admin, who may assign the lead. */
export function AddLeadDialog({ owners, products }: { owners: { id: string; name: string }[]; products: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LeadStatus | "">("");
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const result = await createLead(prev, form);
    if (result.ok) {
      toast.success("Lead added");
      setOpen(false);
      setStatus("");
      router.push(`${pathname}?id=${result.id}`);
    }
    return result;
  }, { ok: false });
  const confirm = useConfirmBeforeSave(action, (form) => {
    const s = String(form.get("status") ?? "") as LeadStatus;
    return [
      ...summarizeLead(form),
      ["Status", s ? `${LEAD_STATUS_LABEL[s]}${s === "NotInterested" ? ` – ${form.get("reason") ?? ""}` : fmtCall(form) ? ` – ${fmtCall(form)}` : ""}` : ""],
    ];
  });
  const err = state.fieldErrors ?? {};

  return (
    <>
      <Button onClick={() => setOpen(true)} className="bg-brand-600 hover:bg-brand-700">Add lead</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogTitle className="text-lg font-semibold">New lead</DialogTitle>
          <form onSubmit={confirm.onSubmit} className="space-y-3">
            <LeadDetailFields initial={EMPTY_LEAD} err={err} products={products} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="status">Lead status<span className="text-destructive"> *</span></Label>
                <NativeSelect id="status" name="status" value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)} className="w-full" aria-invalid={!!err.status}>
                  <NativeSelectOption value=""></NativeSelectOption>
                  {Object.entries(LEAD_STATUS_LABEL).map(([v, l]) => <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}
                </NativeSelect>
                {err.status && <p className="text-xs text-destructive">{err.status}</p>}
              </div>
              {owners.length > 0 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="ownerId">Assign to</Label>
                  <NativeSelect id="ownerId" name="ownerId" className="w-full">
                    {owners.map((o) => <NativeSelectOption key={o.id} value={o.id}>{o.name}</NativeSelectOption>)}
                  </NativeSelect>
                </div>
              ) : (
                <input type="hidden" name="ownerId" value="" />
              )}
            </div>
            {status === "NotInterested" ? (
              <>
                <Field label="Reason" name="reason" error={err.reason} required />
                <input type="hidden" name="callDate" value="" /><input type="hidden" name="callTime" value="" />
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <input type="hidden" name="reason" value="" />
                <div className="space-y-1.5">
                  <Label htmlFor="callDate">{status === "CallBack" ? <>Call back on<span className="text-destructive"> *</span></> : "First call (optional)"}</Label>
                  <DmyDateInput name="callDate" error={err.callDate} required={status === "CallBack"} />
                  {err.callDate && <p className="text-xs text-destructive">{err.callDate}</p>}
                </div>
                <Field label="Time" name="callTime" type="time" />
              </div>
            )}
            {status === "CallBack" && <p className="text-xs text-muted-foreground">Call back opens a call reminder that stays open until the status is updated or the call is rescheduled.</p>}
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save lead"}</Button>
            </div>
          </form>
          {confirm.dialog}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Correct a saved lead's details; the change log keeps the old values. */
export function EditLeadDialog({ leadId, leadNo, initial, products }: { leadId: string; leadNo: string; initial: LeadDetails; products: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const result = await editLead(prev, form);
    if (result.ok) {
      toast.success(`${leadNo} updated`);
      setOpen(false);
      router.refresh();
    }
    return result;
  }, { ok: false });
  const confirm = useConfirmBeforeSave(action, summarizeLead);
  const err = state.fieldErrors ?? {};

  return (
    <>
      <Button type="button" size="xs" variant="outline" onClick={() => setOpen(true)}>Edit details</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogTitle className="text-lg font-semibold">Edit {leadNo}</DialogTitle>
          <form onSubmit={confirm.onSubmit} className="space-y-3">
            <input type="hidden" name="leadId" value={leadId} />
            <LeadDetailFields initial={initial} err={err} products={products} />
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save changes"}</Button>
            </div>
          </form>
          {confirm.dialog}
        </DialogContent>
      </Dialog>
    </>
  );
}
