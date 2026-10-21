"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitKeepingValues } from "@/lib/form";
import { addBillGroupMember, createBillGroup, removeBillGroupMember } from "../group-actions";

/** Admin / Super Admin: a new bill group (name, and who usually pays). */
export function CreateBillGroupForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await createBillGroup(prev, form);
    if (r.ok) {
      toast.success("Bill group created");
      router.push(r.href!);
    }
    return r;
  }, { ok: false });
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={submitKeepingValues(action)} className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">New bill group</h2>
      <div className="space-y-1.5"><Label htmlFor="bg-name">Group name</Label><Input id="bg-name" name="name" placeholder="e.g. Ramesh family" aria-invalid={!!err.name} /></div>
      <div className="space-y-1.5"><Label htmlFor="bg-contact">Usually paid by (optional)</Label><Input id="bg-contact" name="contactName" /></div>
      <div className="space-y-1.5"><Label htmlFor="bg-mobile">Payer&apos;s mobile (optional)</Label><Input id="bg-mobile" name="contactMobile" inputMode="numeric" maxLength={10} aria-invalid={!!err.contactMobile} /></div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Creating…" : "Create bill group"}</Button>
    </form>
  );
}

/** Admin / Super Admin: add a policy / account by its number. */
export function AddMemberForm({ billGroupId }: { billGroupId: string }) {
  const [key, setKey] = useState(0);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await addBillGroupMember(prev, form);
    if (r.ok) {
      toast.success("Added to the group");
      setKey((k) => k + 1);
    }
    return r;
  }, { ok: false });
  return (
    <form key={key} onSubmit={submitKeepingValues(action)} className="flex items-end gap-2">
      <input type="hidden" name="billGroupId" value={billGroupId} />
      <div className="space-y-1"><Label htmlFor="bg-policy" className="text-xs">Policy / account no.</Label><Input id="bg-policy" name="policyNumber" className="h-8 w-56" aria-invalid={!!state.fieldErrors?.policyNumber} /></div>
      <Button type="submit" size="sm" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Adding…" : "Add policy to group"}</Button>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}

export function RemoveMemberButton({ memberId, policyNumber }: { memberId: string; policyNumber: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await removeBillGroupMember(prev, form);
    if (r.ok) toast.success(`${policyNumber} removed`);
    return r;
  }, { ok: false });
  return (
    <form action={action}>
      <input type="hidden" name="memberId" value={memberId} />
      <Button type="submit" size="xs" variant="ghost" disabled={pending} aria-label={`Remove ${policyNumber}`}>{pending ? "Removing…" : "Remove"}</Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
