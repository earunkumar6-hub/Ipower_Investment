"use client";

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { submitKeepingValues } from "@/lib/form";
import { approveExpense, cancelExpense, markExpensePaid, rejectExpense, repayExpense } from "./actions";

type Kind = "reject" | "cancel" | "repay";
const TITLE: Record<Kind, string> = { reject: "Reject", cancel: "Cancel", repay: "Repay" };
const ACTION = { reject: rejectExpense, cancel: cancelExpense, repay: repayExpense };

export function ExpenseRowActions(p: { expenseId: string; expenseNo: string; canApprove: boolean; canCancel: boolean; canRepay: boolean; canPay: boolean }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<Kind | null>(null);
  if (!p.canApprove && !p.canCancel && !p.canRepay && !p.canPay) return null;

  return (
    <div className="flex justify-end gap-1">
      {p.canApprove && (
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700" disabled={pending} onClick={() => start(async () => {
          const r = await approveExpense(p.expenseId);
          if (r.ok) toast.success(r.message ?? `${p.expenseNo} approved`);
          else toast.error(r.error);
        })}>Approve</Button>
      )}
      {p.canPay && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
          const r = await markExpensePaid(p.expenseId);
          if (r.ok) toast.success(`${p.expenseNo} paid; Day Book updated`);
          else toast.error(r.error);
        })}>Mark paid</Button>
      )}
      {p.canApprove && <Button size="sm" variant="outline" onClick={() => setOpen("reject")}>Reject</Button>}
      {p.canRepay && <Button size="sm" variant="outline" onClick={() => setOpen("repay")}>Mark repaid</Button>}
      {p.canCancel && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setOpen("cancel")}>Cancel</Button>}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          {open && <ReasonForm kind={open} {...p} onDone={() => setOpen(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReasonForm({ kind, expenseId, expenseNo, onDone }: { kind: Kind; expenseId: string; expenseNo: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await ACTION[kind](prev, form);
    if (r.ok) {
      toast.success(`${expenseNo}: ${kind === "repay" ? "repaid; Day Book updated" : kind === "reject" ? "rejected" : "cancelled"}`);
      onDone();
    }
    return r;
  }, { ok: false });

  return (
    <form onSubmit={submitKeepingValues(action)} className="space-y-3">
      <DialogTitle className="font-semibold">{TITLE[kind]} {expenseNo}</DialogTitle>
      <input type="hidden" name="expenseId" value={expenseId} />
      {kind === "repay" ? (
        <div className="space-y-1.5">
          <Label htmlFor="from">Repay from</Label>
          <NativeSelect id="from" name="from" className="w-full">
            <NativeSelectOption value="cash">Cash</NativeSelectOption>
            <NativeSelectOption value="bank">SBI ••1234</NativeSelectOption>
          </NativeSelect>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="reason">Reason (required)</Label>
          <Input id="reason" name="reason" autoFocus />
          {kind === "cancel" && <p className="text-xs text-muted-foreground">If money already moved, the Day Book gets a reversing entry today.</p>}
        </div>
      )}
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} variant={kind === "repay" ? "default" : "destructive"}>{pending ? "Saving…" : TITLE[kind]}</Button>
    </form>
  );
}
