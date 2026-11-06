"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { submitKeepingValues } from "@/lib/form";
import { updateTicket } from "../actions";

type Option = { value: string; label: string };

/** Comment + status (+ priority for Admins) in one save. Blank status / priority = keep as is. */
export function TicketUpdateForm({ ticketId, statuses, priorities, hint }: { ticketId: string; statuses: Option[]; priorities: Option[]; hint: string }) {
  const [formKey, setFormKey] = useState(0);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await updateTicket(prev, form);
    if (r.ok) {
      toast.success(r.message ?? "Saved");
      setFormKey((k) => k + 1);
    }
    return r;
  }, { ok: false });
  return (
    <form key={formKey} onSubmit={submitKeepingValues(action)} className="space-y-3 rounded-lg border p-3">
      <input type="hidden" name="ticketId" value={ticketId} />
      <div className="space-y-1.5">
        <Label htmlFor="comment">Comment</Label>
        <Textarea id="comment" name="comment" rows={3} maxLength={4000} placeholder="Reply, what was done, what is still wrong…" aria-invalid={!!state.fieldErrors?.comment} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {statuses.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="status">Change status</Label>
            <NativeSelect id="status" name="status" defaultValue="" className="w-56">
              <NativeSelectOption value=""></NativeSelectOption>
              {statuses.map((s) => <NativeSelectOption key={s.value} value={s.value}>{s.label}</NativeSelectOption>)}
            </NativeSelect>
          </div>
        )}
        {priorities.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="priority">Change priority</Label>
            <NativeSelect id="priority" name="priority" defaultValue="" className="w-40">
              <NativeSelectOption value=""></NativeSelectOption>
              {priorities.map((p) => <NativeSelectOption key={p.value} value={p.value}>{p.label}</NativeSelectOption>)}
            </NativeSelect>
          </div>
        )}
        <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save"}</Button>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <p className="text-xs text-muted-foreground">{hint}</p>
    </form>
  );
}
