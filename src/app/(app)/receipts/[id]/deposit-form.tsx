"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { depositOneRdReceipt } from "@/app/(app)/daybook/actions";
import { payToCompany } from "@/app/(app)/renewals/actions";
import { Button } from "@/components/ui/button";
import { DmyDateInput } from "@/components/dmy-date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CashDenominationGrid, paise } from "@/components/cash-denomination-grid";
import { submitKeepingValues } from "@/lib/form";

type Props = { receiptId: string; amount: string; company: string; isRd: boolean; accounts: { id: string; name: string; type: string }[]; today: string };

/** Mark this receipt's money as paid to the company with its deposit / transaction ID; the Day Book records it going out. */
export function DepositStatusForm({ receiptId, amount, company, isRd, accounts, today }: Props) {
  const [accountId, setAccountId] = useState("");
  const fromCash = accounts.find((a) => a.id === accountId)?.type === "Cash";
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await (isRd ? depositOneRdReceipt : payToCompany)(prev, form);
    if (r.ok) toast.success(`Marked paid to ${company}; Day Book updated`);
    return r;
  }, { ok: false });

  return (
    <form onSubmit={submitKeepingValues(action)} className="w-80 shrink-0 space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">Update deposit status</h2>
      <input type="hidden" name="receiptId" value={receiptId} />
      <input type="hidden" name="receiptIds" value={receiptId} />
      <div className="space-y-1.5">
        <Label htmlFor="reference">{isRd ? "Post office receipt / transaction ID" : `${company} receipt / transaction ID`}</Label>
        <Input id="reference" name="reference" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5"><Label htmlFor="paidOn">Paid on</Label><DmyDateInput name="paidOn" defaultValue={today} max={today} /></div>
        <div className="space-y-1.5">
          <Label htmlFor="accountId">Paid from</Label>
          <NativeSelect id="accountId" name="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-full">
            <NativeSelectOption value=""></NativeSelectOption>
            {accounts.map((a) => <NativeSelectOption key={a.id} value={a.id}>{a.name}</NativeSelectOption>)}
          </NativeSelect>
        </div>
      </div>
      {fromCash && <CashDenominationGrid amount={paise(amount)} idPrefix="dep" />}
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : `Mark paid to ${company}`}</Button>
      <p className="text-xs text-muted-foreground">
        The Day Book records the money leaving the chosen account. Once paid, the receipt can&apos;t be cancelled.
        {isRd && " For several RD receipts at once, use Deposit to Post Office in the Day Book."}
      </p>
    </form>
  );
}
