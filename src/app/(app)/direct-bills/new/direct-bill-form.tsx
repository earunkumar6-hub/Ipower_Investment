"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { emptyPay, paise, payFormFields, PaymentFields, payReady, type PayValue } from "@/components/payment-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isoDate, istToday } from "@/lib/dates";
import type { ReceiptMode } from "@/lib/payment-modes";
import { createDirectBill } from "../actions";

export function DirectBillForm({ modes, banks, receivedBy }: { modes: ReceiptMode[]; banks: string[]; receivedBy: string }) {
  const router = useRouter();
  const today = isoDate(istToday());
  const [f, setF] = useState({ payerName: "", payerMobile: "", purpose: "", amount: "", billDate: today });
  const [pay, setPay] = useState<PayValue>(emptyPay(modes));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const [state, dispatch, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await createDirectBill(prev, form);
    if (r.ok) {
      toast.success("Bill saved and sent to the payer");
      router.push(r.href ?? "/direct-bills");
    }
    return r;
  }, { ok: false });
  const err = state.fieldErrors ?? {};

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    const form = new FormData();
    Object.entries({ ...f, ...payFormFields(pay) }).forEach(([k, v]) => form.set(k, v));
    startTransition(() => dispatch(form));
  }

  return (
    <form onSubmit={onSave} className="max-w-3xl space-y-4 rounded-xl border bg-white p-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="payerName">Name</Label>
          <Input id="payerName" value={f.payerName} onChange={set("payerName")} aria-invalid={!!err.payerName} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="payerMobile">Mobile</Label>
          <Input id="payerMobile" value={f.payerMobile} inputMode="numeric" maxLength={10} onChange={set("payerMobile")} aria-invalid={!!err.payerMobile} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="purpose">Purpose</Label>
          <Input id="purpose" value={f.purpose} placeholder="e.g. Form filling charges, document copy" onChange={set("purpose")} aria-invalid={!!err.purpose} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="amount">Amount received (₹)</Label>
          <Input id="amount" value={f.amount} inputMode="decimal" onChange={set("amount")} aria-invalid={!!err.amount} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="billDate">Bill date</Label>
          <Input id="billDate" type="date" value={f.billDate} max={today} required onChange={set("billDate")} aria-invalid={!!err.billDate} />
        </div>
        <div className="space-y-1.5">
          <Label>Received by</Label>
          <div className="flex h-8 items-center rounded-lg border bg-slate-50 px-2.5 text-sm">{receivedBy}</div>
        </div>
        <PaymentFields modes={modes} banks={banks} amount={paise(f.amount)} value={pay} onChange={setPay} errors={err} />
      </div>
      <p className="text-xs text-muted-foreground">
        For anyone, customer or not. If the mobile belongs to a customer, the bill is linked to that customer. The Day Book records it on the bill date.
      </p>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending || !payReady(pay, paise(f.amount))} className="bg-brand-600 hover:bg-brand-700">
        {pending ? "Saving…" : "Save bill"}
      </Button>
    </form>
  );
}
