"use client";

import { TriangleAlert } from "lucide-react";
import { useActionState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { cancelPayment } from "@/app/(app)/receipts/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitKeepingValues } from "@/lib/form";

export function CancelPaymentForm({ paymentId, paymentNo, lines }: { paymentId: string; paymentNo: string; lines: number }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await cancelPayment(prev, form);
    if (r.ok) toast.success(`${paymentNo} cancelled; Day Book reversed`);
    return r;
  }, { ok: false });

  return (
    <form onSubmit={submitKeepingValues(action)} className="w-80 shrink-0 space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">Cancel this payment</h2>
      <input type="hidden" name="paymentId" value={paymentId} />
      <div className="space-y-1.5">
        <Label htmlFor="reason">Reason (required)</Label>
        <Input id="reason" name="reason" placeholder="e.g. Customer paid twice by mistake" />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" variant="destructive" disabled={pending} className="w-full"><TriangleAlert />{pending ? "Cancelling…" : "Cancel payment"}</Button>
      <p className="text-xs text-muted-foreground">
        Admin and Super Admin only. All {lines} receipt lines are cancelled together, the Day Book gets reversing entries today, and the
        instalments show unpaid again. Not possible once an RD line is deposited at the post office.
      </p>
    </form>
  );
}
