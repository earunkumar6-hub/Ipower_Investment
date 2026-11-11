"use client";

import { TriangleAlert } from "lucide-react";
import { useActionState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitKeepingValues } from "@/lib/form";
import { cancelDirectBill } from "../actions";

export function CancelDirectBillForm({ billId, billNo }: { billId: string; billNo: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await cancelDirectBill(prev, form);
    if (r.ok) toast.success(`${billNo} cancelled; Day Book reversed`);
    return r;
  }, { ok: false });

  return (
    <form onSubmit={submitKeepingValues(action)} className="w-80 shrink-0 space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">Cancel this bill</h2>
      <input type="hidden" name="billId" value={billId} />
      <div className="space-y-1.5">
        <Label htmlFor="reason">Reason (required)</Label>
        <Input id="reason" name="reason" />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" variant="destructive" disabled={pending} className="w-full"><TriangleAlert />{pending ? "Cancelling…" : "Cancel bill"}</Button>
      <p className="text-xs text-muted-foreground">
        Admin and Super Admin only. The number is never reused and the Day Book gets a reversing entry today.
      </p>
    </form>
  );
}
