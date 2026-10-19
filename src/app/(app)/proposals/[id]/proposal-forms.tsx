"use client";

import { LockIcon } from "lucide-react";
import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitKeepingValues } from "@/lib/form";
import { issuePolicy, saveKyc, simulateCustomerOtp } from "../actions";

export function SimulateOtpButton({ proposalId }: { proposalId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
      const r = await simulateCustomerOtp(proposalId);
      if (r.ok) toast.success("Customer approved by OTP");
      else toast.error(r.error);
    })}>
      {pending ? "Verifying…" : "Simulate customer OTP"}
    </Button>
  );
}

export function KycForm({ proposalId, unlocked, panMasked, aadhaarLast4 }: { proposalId: string; unlocked: boolean; panMasked: string | null; aadhaarLast4: string | null }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await saveKyc(prev, form);
    if (r.ok) toast.success("Aadhaar and PAN saved (masked)");
    return r;
  }, { ok: false });

  return (
    <form onSubmit={submitKeepingValues(action)} className="space-y-3">
      <input type="hidden" name="proposalId" value={proposalId} />
      <div className="space-y-1.5">
        <Label htmlFor="aadhaar">Aadhaar</Label>
        <Input id="aadhaar" name="aadhaar" readOnly={!unlocked} inputMode="numeric" maxLength={14}
          placeholder={aadhaarLast4 ? `XXXX-XXXX-${aadhaarLast4}` : unlocked ? "12 digits" : "Locked until consent"} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pan">PAN</Label>
        <Input id="pan" name="pan" readOnly={!unlocked} maxLength={10} className="not-placeholder-shown:uppercase"
          placeholder={panMasked ?? (unlocked ? "ABCDE1234F" : "Locked until consent")} />
      </div>
      {unlocked ? (
        <p className="rounded-lg bg-green-50 p-2 text-xs text-green-900">
          Unlocked because the customer approved by OTP. Only masked values are stored and shown.
        </p>
      ) : (
        <p className="flex gap-2 rounded-lg bg-slate-100 p-2 text-xs text-slate-700">
          <LockIcon className="size-4 shrink-0" />
          {panMasked ? "Saved and masked." : "Locked for every role until the customer approves by OTP."}
        </p>
      )}
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {(unlocked || !panMasked) && (
        <Button type="submit" variant="outline" disabled={pending} className="w-full">
          {pending ? "Saving…" : "Save Aadhaar / PAN"}
        </Button>
      )}
    </form>
  );
}

export function IssuePolicyForm({ proposalId, ready }: { proposalId: string; ready: boolean }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await issuePolicy(prev, form);
    if (r.ok) toast.success("Policy issued; customer and renewals created");
    return r;
  }, { ok: false });

  return (
    <form onSubmit={submitKeepingValues(action)} className="flex flex-wrap items-end gap-2 border-t pt-4">
      <input type="hidden" name="proposalId" value={proposalId} />
      <div className="space-y-1.5">
        <Label htmlFor="policyNumber">Policy number (from the partner)</Label>
        <Input id="policyNumber" name="policyNumber" className="w-64 not-placeholder-shown:uppercase" disabled={!ready} placeholder={ready ? "e.g. STAR-P-700123" : "Needs consent and PAN first"} />
      </div>
      <Button type="submit" disabled={!ready || pending} className="bg-brand-600 hover:bg-brand-700">
        {pending ? "Issuing…" : "Save policy number"}
      </Button>
      {state.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
