"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitKeepingValues } from "@/lib/form";
import { saveTicketAlerts } from "./actions";

/** Developer contacts for new-ticket alerts (Settings.Edit). */
export function AlertContactsForm({ mobile, email }: { mobile: string; email: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await saveTicketAlerts(prev, form);
    if (r.ok) toast.success(r.message ?? "Saved");
    return r;
  }, { ok: false });
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={submitKeepingValues(action)} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="alert-mobile">WhatsApp mobile</Label>
        <Input id="alert-mobile" name="mobile" defaultValue={mobile} inputMode="numeric" maxLength={10} className="w-48" aria-invalid={!!err.mobile} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="alert-email">Email</Label>
        <Input id="alert-email" name="email" type="email" defaultValue={email} className="w-72" aria-invalid={!!err.email} />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      {state.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
