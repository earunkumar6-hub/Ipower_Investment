"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { markMatured, markNotRenewed, sendMaturityReminder, sendRenewalReminder } from "./actions";

/** Reminder buttons: filled saffron (logo colour) next to the crimson "Take payment" (owner, 4 Nov 2026). */
const REMIND = "bg-saffron-500 from-saffron-400 to-saffron-500 text-saffron-900 shadow-saffron-900/20 hover:from-saffron-300 hover:to-saffron-400 hover:shadow-saffron-900/25";

/** Maturity reminder row: send the (mock) WhatsApp; once a one-time deposit has matured, mark it matured. */
export function MaturityRowActions({ policyId, matured }: { policyId: string; matured: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" disabled={pending} className={REMIND} onClick={() => start(async () => {
        const r = await sendMaturityReminder(policyId);
        if (r.ok) toast.success("Maturity reminder logged in Sent messages (mock WhatsApp)"); else toast.error(r.error);
      })}>Send maturity reminder</Button>
      {matured && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
          const r = await markMatured(policyId);
          if (r.ok) toast.success("Marked as matured"); else toast.error(r.error);
        })}>Mark matured</Button>
      )}
    </div>
  );
}

export function RenewalRowActions({ renewalItemId, customerId, overdue }: { renewalItemId: string; customerId: string; overdue: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" disabled={pending} className={REMIND} onClick={() => start(async () => {
        const r = await sendRenewalReminder(renewalItemId);
        if (r.ok) toast.success("Reminder logged in Sent messages (mock WhatsApp)");
        else toast.error(r.error);
      })}>Send reminder</Button>
      <Link href={`/receipts/new?customerId=${customerId}`} className={`${buttonVariants({ size: "sm" })} bg-brand-600 text-white hover:bg-brand-700`}>Take payment</Link>
      {overdue && <NotRenewedButton renewalItemId={renewalItemId} />}
    </div>
  );
}

/** The customer won't renew: the policy becomes Lapsed and reminders stop. */
function NotRenewedButton({ renewalItemId }: { renewalItemId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setOpen(true)}>Not renewed</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle className="text-lg font-semibold">Not renewed</DialogTitle>
          <div className="space-y-1.5">
            <Label htmlFor={`nr-${renewalItemId}`}>Reason</Label>
            <Input id={`nr-${renewalItemId}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Moved to another insurer" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground">The policy becomes Lapsed (shown on the customer page); its unpaid instalments lapse and no more reminders go out.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Back</Button>
            <Button type="button" disabled={pending} onClick={() => start(async () => {
              const r = await markNotRenewed(renewalItemId, reason);
              if (!r.ok) return setError(r.error ?? "Could not save");
              toast.success("Marked not renewed");
              setOpen(false);
            })}>{pending ? "Saving…" : "Mark not renewed"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
