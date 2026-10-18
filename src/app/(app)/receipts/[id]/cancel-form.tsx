"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitKeepingValues } from "@/lib/form";
import { cancelReceipt } from "../actions";

export function CancelReceiptForm({ receiptId, receiptNo }: { receiptId: string; receiptNo: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await cancelReceipt(prev, form);
    if (r.ok) toast.success(`${receiptNo} cancelled; Day Book reversed`);
    return r;
  }, { ok: false });

  return (
    <form onSubmit={submitKeepingValues(action)} className="w-80 shrink-0 space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">Cancel this receipt</h2>
      <input type="hidden" name="receiptId" value={receiptId} />
      <div className="space-y-1.5">
        <Label htmlFor="reason">Reason (required)</Label>
        <Input id="reason" name="reason" placeholder="e.g. Customer paid twice by mistake" />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" variant="destructive" disabled={pending} className="w-full">{pending ? "Cancelling…" : "Cancel receipt"}</Button>
      <p className="text-xs text-muted-foreground">
        Admin and Super Admin only. The number is never reused, the Day Book gets a reversing entry today, and the instalment shows unpaid again.
      </p>
    </form>
  );
}
