"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { submitKeepingValues } from "@/lib/form";
import { setVerification } from "./actions";

/** Row action: Verified, or Mismatch with a note. */
export function VerifyForm({ kind, id }: { kind: "PoDeposit" | "CompanyPayment"; id: string }) {
  const [status, setStatus] = useState("");
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await setVerification(prev, form);
    if (r.ok) toast.success("Verification saved");
    return r;
  }, { ok: false });

  return (
    <form onSubmit={submitKeepingValues(action)} className="flex flex-wrap items-start gap-1.5">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <NativeSelect name="status" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Result">
        <NativeSelectOption value="">Result…</NativeSelectOption>
        <NativeSelectOption value="Verified">Verified</NativeSelectOption>
        <NativeSelectOption value="Mismatch">Mismatch</NativeSelectOption>
      </NativeSelect>
      {status === "Mismatch" && <Input name="note" className="w-44" aria-invalid={!!state.fieldErrors?.note} />}
      <Button type="submit" size="sm" variant="outline" disabled={pending || !status}>{pending ? "Saving…" : "Save"}</Button>
      {state.error && <p className="w-full text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
