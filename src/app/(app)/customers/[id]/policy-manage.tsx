"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deactivatePolicy, deletePolicy, reactivatePolicy } from "../policy-actions";

/**
 * Deactivate / switch back on / delete one product (owner change list, #25). Used on the customer's holdings and on
 * Renewals rows. `canDeactivate` = Policy.Deactivate (Admin, Super Admin); `canDelete` = Policy.Delete (Super Admin).
 */
export function PolicyManageButton({ policyId, label, deactivated, canDeactivate, canDelete }: {
  policyId: string; label: string; deactivated: boolean; canDeactivate: boolean; canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (!canDeactivate && !canDelete) return null;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => {
    setError("");
    const r = await fn();
    if (!r.ok) return setError(r.error ?? "Could not save");
    toast.success(done);
    setOpen(false);
    setReason("");
    setConfirm("");
  });

  return (
    <>
      <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setOpen(true)}>
        {deactivated ? (canDeactivate ? "Switch on / delete" : "Delete") : canDeactivate ? (canDelete ? "Deactivate / delete" : "Deactivate") : "Delete"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="text-lg font-semibold">{label}</DialogTitle>
          {canDeactivate && !deactivated && (
            <div className="space-y-2">
              <h3 className="font-medium">Deactivate</h3>
              <div className="space-y-1.5">
                <Label htmlFor={`pd-${policyId}`}>Reason</Label>
                <Input id={`pd-${policyId}`} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">Unpaid bills stop and no reminders go out. Receipts and paid history stay. It can be switched back on later.</p>
              <Button type="button" disabled={pending} onClick={() => run(() => deactivatePolicy(policyId, reason), "Deactivated")}>{pending ? "Saving…" : "Deactivate"}</Button>
            </div>
          )}
          {canDeactivate && deactivated && (
            <div className="space-y-2">
              <h3 className="font-medium">Switch back on</h3>
              <p className="text-xs text-muted-foreground">Its stopped bills become due again (overdue if the date has passed) and reminders resume.</p>
              <Button type="button" disabled={pending} onClick={() => run(() => reactivatePolicy(policyId), "Switched back on")}>{pending ? "Saving…" : "Switch back on"}</Button>
            </div>
          )}
          {canDelete && (
            <div className="space-y-2 border-t pt-3">
              <h3 className="font-medium text-destructive">Delete</h3>
              <p className="text-xs text-muted-foreground">
                Only for a product entered by mistake: refused once it has a receipt, owner-paid slip or commission, or was issued from a proposal.
                Its bills and follow-ups are removed; the change log keeps a record. This can&apos;t be undone.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor={`pdel-${policyId}`}>Type DELETE to confirm</Label>
                <Input id={`pdel-${policyId}`} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
              </div>
              <Button type="button" variant="destructive" disabled={pending || confirm.trim().toUpperCase() !== "DELETE"}
                onClick={() => run(() => deletePolicy(policyId, confirm), "Deleted")}>{pending ? "Deleting…" : "Delete product"}</Button>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
