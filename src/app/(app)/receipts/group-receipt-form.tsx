"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { emptyPay, inr, type IntoAccount, paise, payFormFields, PaymentFields, payReady, type PayValue } from "@/components/payment-fields";
import { Button } from "@/components/ui/button";
import { DmyDateInput } from "@/components/dmy-date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isoDate, istToday } from "@/lib/dates";
import type { ReceiptMode } from "@/lib/payment-modes";
import type { PolicyOption } from "@/lib/receipt-options";
import { BillsPicker, ticked, unpaidCounts } from "./bills-picker";
import { createGroupReceipt } from "./group-actions";

/**
 * One receipt for many bills: a combined receipt (bills ticked across customers) or a bill group's receipt.
 * Made out to the person who paid ("Paid by"); every bill keeps its own line under its own customer.
 */
export function GroupReceiptForm({ kind, billGroupId, policies, payer, modes, banks, accounts, receivedBy, preset }: {
  kind: "Combined" | "BillGroup"; billGroupId?: string; policies: PolicyOption[]; payer: { name: string; mobile: string };
  modes: ReceiptMode[]; banks: string[]; accounts: IntoAccount[]; receivedBy: string;
  /** Bills already ticked (e.g. from Renewals). */
  preset?: Record<string, number>;
}) {
  const router = useRouter();
  // A bill group starts with every overdue and due bill ticked; a combined receipt starts blank.
  const [counts, setCounts] = useState<Record<string, number>>(preset ?? (kind === "BillGroup" ? unpaidCounts(policies) : {}));
  const [pay, setPay] = useState<PayValue>(emptyPay(modes, accounts));
  const [payerName, setPayerName] = useState(payer.name);
  const [payerMobile, setPayerMobile] = useState(payer.mobile);
  const [poReceiptNo, setPoReceiptNo] = useState("");
  const [notes, setNotes] = useState("");
  const today = isoDate(istToday());
  const [receiptDate, setReceiptDate] = useState(today);
  const [txnDate, setTxnDate] = useState(today);
  const t = ticked(policies, counts);
  const amount = (t.total / 100).toFixed(2);

  const [state, dispatch, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await createGroupReceipt(prev, form);
    if (r.ok) {
      toast.success("Receipt saved and sent to the payer");
      router.push(r.href!);
    }
    return r;
  }, { ok: false });

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    const form = new FormData();
    Object.entries({
      kind, billGroupId: billGroupId ?? "", dues: JSON.stringify(t.dues), amount, payerName, payerMobile, poReceiptNo, notes, receiptDate, txnDate, ...payFormFields(pay),
    }).forEach(([k, v]) => form.set(k, v));
    startTransition(() => dispatch(form));
  }
  const err = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSave} className="max-w-5xl space-y-4 rounded-xl border bg-white p-4">
      <BillsPicker policies={policies} counts={counts} onChange={setCounts} showCustomer
        scope={billGroupId ? { billGroupId } : undefined} search={kind === "Combined"} showSettled={kind === "BillGroup"} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="payerName">Paid by</Label>
          <Input id="payerName" value={payerName} onChange={(e) => setPayerName(e.target.value)} aria-invalid={!!err.payerName} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="payerMobile">Payer&apos;s mobile (receipt goes here on WhatsApp)</Label>
          <Input id="payerMobile" value={payerMobile} onChange={(e) => setPayerMobile(e.target.value)} inputMode="numeric" maxLength={10} aria-invalid={!!err.payerMobile} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="receiptDate">Bill date</Label>
          <DmyDateInput id="receiptDate" value={receiptDate} max={today} required onChange={setReceiptDate} aria-invalid={!!err.receiptDate} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="txnDate">Transaction date</Label>
          <DmyDateInput id="txnDate" value={txnDate} max={today} required onChange={setTxnDate} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="amount">Amount received (₹)</Label>
          <Input id="amount" value={amount} readOnly aria-invalid={!!err.amount} />
        </div>
        <div className="space-y-1.5">
          <Label>Received by</Label>
          <div className="flex h-8 items-center rounded-lg border bg-slate-50 px-2.5 text-sm">{receivedBy}</div>
        </div>
        <PaymentFields modes={modes} banks={banks} accounts={accounts} amount={t.total} value={pay} onChange={setPay} errors={err} />
        <div className="space-y-1.5">
          <Label htmlFor="poReceiptNo">PO receipt no. (optional)</Label>
          <Input id="poReceiptNo" value={poReceiptNo} onChange={(e) => setPoReceiptNo(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes</Label>
          <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending || t.count === 0 || !payReady(pay, t.total)} className="bg-brand-600 hover:bg-brand-700">
        {pending ? "Saving…" : `Generate one receipt${t.count ? ` · ${t.count} bill(s) · ${inr(t.total)}` : ""}`}
      </Button>
      <p className="text-xs text-muted-foreground">
        One PAY- receipt for the payer; each bill is marked paid with that receipt number and keeps its own line under its customer
        (RD lines go to the post office deposit as usual). The PDF lists the split per bill.{paise(amount) === 0 && " Tick at least one bill."}
      </p>
    </form>
  );
}
