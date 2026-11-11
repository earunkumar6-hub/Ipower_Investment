"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DmyDateInput } from "@/components/dmy-date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isoToDmy } from "@/lib/dates";
import { submitKeepingValues } from "@/lib/form";
import { closePolicy } from "../actions";

type Props = { policyId: string; label: string; isMf: boolean; today: string; startDate: string; lockInUntil: string | null };

/** "Close early" (all products except mutual funds) or "Withdraw" (mutual funds): stops bills and reminders. */
export function ClosePolicyButton({ policyId, label, isMf, today, startDate, lockInUntil }: Props) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await closePolicy(prev, form);
    if (r.ok) {
      toast.success(isMf ? `${label} withdrawn` : `${label} closed early`);
      setOpen(false);
    }
    return r;
  }, { ok: false });
  const title = isMf ? "Withdraw mutual fund" : "Premature closure";
  const locked = !!lockInUntil && lockInUntil > today; // ISO dates compare as text

  return (
    <>
      <Button type="button" size="xs" variant="outline" onClick={() => setOpen(true)}>{isMf ? "Withdraw" : "Close early"}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          <p className="text-sm text-muted-foreground">{label}</p>
          <form onSubmit={submitKeepingValues(action)} className="space-y-3">
            <input type="hidden" name="policyId" value={policyId} />
            <input type="hidden" name="kind" value={isMf ? "withdraw" : "close"} />
            <div className="space-y-1.5">
              <Label htmlFor="closedOn">{isMf ? "Withdraw date" : "Closure date"}</Label>
              <DmyDateInput name="closedOn" defaultValue={today} min={locked ? undefined : lockInUntil ?? startDate} max={today} disabled={locked} />
              {lockInUntil && <p className={locked ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>Lock-in runs until {isoToDmy(lockInUntil.slice(0, 10))}{locked && "; it can't be closed before then"}.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason{isMf ? " (optional)" : ""}</Label>
              <Input id="reason" name="reason" aria-invalid={!!state.fieldErrors?.reason} />
            </div>
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            <p className="text-xs text-muted-foreground">Unpaid instalments stop and no more reminders go out. Paid history stays. No money is recorded in the Day Book.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Back</Button>
              <Button type="submit" disabled={pending || locked} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : isMf ? "Withdraw" : "Close early"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
