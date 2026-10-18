"use client";

import { usePathname, useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { LEAD_SOURCE_LABEL } from "@/lib/lead-labels";
import { submitKeepingValues } from "@/lib/form";
import { createLead, type ActionResult } from "./actions";

/** `owners` is non-empty only for Admin / Super Admin, who may assign the lead. */
export function AddLeadDialog({ owners }: { owners: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const result = await createLead(prev, form);
    if (result.ok) {
      toast.success("Lead added");
      setOpen(false);
      router.push(`${pathname}?id=${result.id}`);
    }
    return result;
  }, { ok: false });
  const err = state.fieldErrors ?? {};

  return (
    <>
      <Button onClick={() => setOpen(true)} className="bg-blue-600 hover:bg-blue-700">Add lead</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="text-lg font-semibold">Add lead</DialogTitle>
          <form onSubmit={submitKeepingValues(action)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" name="name" error={err.name} required />
              <Field label="Mobile" name="mobile" error={err.mobile} inputMode="numeric" maxLength={10} required />
            </div>
            <Field label="Email (optional)" name="email" error={err.email} type="email" />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="source">Source</Label>
                <NativeSelect id="source" name="source" defaultValue="WalkIn" className="w-full">
                  {Object.entries(LEAD_SOURCE_LABEL).map(([v, l]) => <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}
                </NativeSelect>
              </div>
              {owners.length > 0 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="ownerId">Assign to</Label>
                  <NativeSelect id="ownerId" name="ownerId" className="w-full">
                    {owners.map((o) => <NativeSelectOption key={o.id} value={o.id}>{o.name}</NativeSelectOption>)}
                  </NativeSelect>
                </div>
              ) : (
                <input type="hidden" name="ownerId" value="" />
              )}
            </div>
            <Field label="Interested in" name="interest" placeholder="e.g. Health cover for parents" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="First call (optional)" name="callDate" type="date" error={err.callDate} />
              <Field label="Time" name="callTime" type="time" />
            </div>
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending} className="bg-blue-600 hover:bg-blue-700">{pending ? "Saving…" : "Save lead"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, name, error, ...props }: { label: string; name: string; error?: string } & React.ComponentProps<"input">) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} aria-invalid={!!error} {...props} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
