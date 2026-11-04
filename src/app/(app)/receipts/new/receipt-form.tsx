"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, startTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { emptyPay, type IntoAccount, inr, paise, payFormFields, PaymentFields, payReady, type PayValue } from "@/components/payment-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isoDate, istToday } from "@/lib/dates";
import { MODE_LABEL, type ReceiptMode } from "@/lib/payment-modes";
import type { PolicyOption } from "@/lib/receipt-options";
import { cn } from "@/lib/utils";
import { createReceipt } from "../actions";
import { BillsPicker, ticked as tickedBills, unpaidCounts } from "../bills-picker";

type Slip = { id: string; slipNo: string; account: string; month: string; amount: string; poReceiptNo: string };

export function ReceiptForm({ customer, policies, openSlips, modes, banks, accounts, receivedBy }: {
  customer: { id: string; name: string; mobile: string }; policies: PolicyOption[]; openSlips: Slip[];
  modes: ReceiptMode[]; banks: string[]; accounts: IntoAccount[]; receivedBy: string;
}) {
  const router = useRouter();
  // Every overdue and due bill starts ticked; with owner-paid slips open the payment is usually for them, so start blank.
  // Ticks stay oldest-first per policy (the server pays the oldest `count` bills): `counts[policyId]` = bills ticked.
  const [counts, setCounts] = useState<Record<string, number>>(openSlips.length ? {} : unpaidCounts(policies));
  const [otherPolicyId, setOtherPolicyId] = useState("");
  const [otherAmount, setOtherAmount] = useState("");
  const [pay, setPay] = useState<PayValue>(emptyPay(modes, accounts));
  const [notes, setNotes] = useState("");
  const today = isoDate(istToday());
  const [receiptDate, setReceiptDate] = useState(today);
  const [txnDate, setTxnDate] = useState(today);
  const [popup, setPopup] = useState(false);
  const [ticked, setTicked] = useState<string[]>(openSlips.map((s) => s.id));

  const [state, dispatch, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await createReceipt(prev, form);
    if (r.ok) {
      toast.success(r.href?.startsWith("/payments") ? "Payment saved and sent to the customer" : "Receipt saved and sent to the customer");
      router.push(r.href ?? `/receipts/${r.id}`);
    } else setPopup(false);
    return r;
  }, { ok: false });

  const withDues = policies.filter((p) => p.dues.length);
  const { dues: pickedDues, total: duesTotal, count: dueCount } = tickedBills(withDues, counts);
  const amount = dueCount ? (duesTotal / 100).toFixed(2) : otherAmount;

  function submit(slipIds: string[]) {
    const form = new FormData();
    const dues = slipIds.length ? [] : pickedDues;
    Object.entries({
      customerId: customer.id, policyId: dues.length ? "" : otherPolicyId, dues: dues.length ? JSON.stringify(dues) : "",
      amount, notes, slipIds: slipIds.join(","), receiptDate, txnDate, ...payFormFields(pay),
    }).forEach(([k, v]) => form.set(k, v));
    startTransition(() => dispatch(form));
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    // Owner already paid some bills for this customer: ask before recording a fresh payment.
    if (openSlips.length) setPopup(true);
    else submit([]);
  }

  const selected = openSlips.filter((s) => ticked.includes(s.id)).reduce((t, s) => t + paise(s.amount), 0);
  const diff = paise(amount) - selected;
  const err = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSave} className="max-w-4xl space-y-4 rounded-xl border bg-white p-4">
      <div>
        <h2 className="font-semibold">{customer.name}</h2>
        <p className="text-xs text-muted-foreground">{customer.mobile}{openSlips.length > 0 && ` · ${openSlips.length} owner-paid bill(s) open`}</p>
      </div>

      {withDues.length > 0 && <BillsPicker policies={withDues} counts={counts} onChange={setCounts} scope={{ customerId: customer.id }} />}

      <div className="grid grid-cols-2 gap-3">
        {dueCount === 0 && (
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="policyId">{withDues.length ? "Or another payment – policy / account" : "Policy / account"}</Label>
            <NativeSelect id="policyId" value={otherPolicyId} className="w-full" aria-invalid={!!err.policyId} onChange={(e) => setOtherPolicyId(e.target.value)}>
              <NativeSelectOption value=""></NativeSelectOption>
              {policies.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.label}</NativeSelectOption>)}
            </NativeSelect>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="receiptDate">Bill date</Label>
          <Input id="receiptDate" type="date" value={receiptDate} max={today} required onChange={(e) => setReceiptDate(e.target.value)} aria-invalid={!!err.receiptDate} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="txnDate">Transaction date</Label>
          <Input id="txnDate" type="date" value={txnDate} max={today} required onChange={(e) => setTxnDate(e.target.value)} aria-invalid={!!err.txnDate} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="amount">Amount received (₹)</Label>
          <Input id="amount" value={amount} onChange={(e) => setOtherAmount(e.target.value)} readOnly={dueCount > 0} inputMode="decimal" aria-invalid={!!err.amount} />
        </div>
        <div className="space-y-1.5">
          <Label>Received by</Label>
          <div className="flex h-8 items-center rounded-lg border bg-slate-50 px-2.5 text-sm">{receivedBy}</div>
        </div>
        <PaymentFields modes={modes} banks={banks} accounts={accounts} amount={paise(amount)} value={pay} onChange={setPay} errors={err} />
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="notes">Notes</Label>
          <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {pay.mode === "Cash" ? "Goes into cash in hand." : `Goes into ${accounts.find((a) => a.id === pay.intoAccountId)?.label ?? "the bank account picked"}.`} The Day Book records it on the bill date. RD instalments are marked Collected until deposited at the post office.
      </p>
      {state.error && !popup && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending || !payReady(pay, paise(amount))} className="bg-brand-600 hover:bg-brand-700">
        {pending ? "Saving…" : dueCount > 1 ? `Generate one receipt · ${inr(duesTotal)}` : "Save receipt"}
      </Button>

      <Dialog open={popup} onOpenChange={setPopup}>
        <DialogContent className="sm:max-w-xl">
          <span className="w-fit rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">Owner-paid bills found</span>
          <DialogTitle className="text-lg font-semibold">{customer.name} paid {inr(paise(amount))} ({MODE_LABEL[pay.mode]})</DialogTitle>
          <DialogDescription>The owner already paid these bills (at the post office or to the insurer). Adjust this payment against them?</DialogDescription>
          <Table>
            <TableHeader>
              <TableRow><TableHead /><TableHead>Slip</TableHead><TableHead>Policy / account</TableHead><TableHead>Bill</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Reference no.</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {openSlips.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <input type="checkbox" aria-label={`Adjust ${s.slipNo}`} checked={ticked.includes(s.id)}
                      onChange={(e) => setTicked(e.target.checked ? [...ticked, s.id] : ticked.filter((id) => id !== s.id))} />
                  </TableCell>
                  <TableCell>{s.slipNo}</TableCell><TableCell>{s.account}</TableCell><TableCell>{s.month}</TableCell>
                  <TableCell className="text-right">{inr(paise(s.amount))}</TableCell><TableCell>{s.poReceiptNo}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-between text-sm font-medium">
            <span>Payment {inr(paise(amount))} · selected {inr(selected)}</span>
            <span className={cn(diff !== 0 && "text-destructive")}>Difference {inr(diff)}</span>
          </div>
          <p className="rounded-lg bg-saffron-50 p-3 text-xs text-saffron-900">
            On adjusting: a customer receipt is created and sent; the ticked slips close automatically against it (no separate owner invoice remains),
            and the money moves to &quot;Return to owner&quot;. It is not added to the post office deposit or paid to the company again.
          </p>
          {state.error && popup && <p className="text-sm text-destructive">{state.error}</p>}
          <div className="flex gap-2">
            <Button type="button" disabled={pending || diff !== 0 || !ticked.length} className="bg-brand-600 hover:bg-brand-700" onClick={() => submit(ticked)}>
              Adjust and create receipt
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => submit([])}>Record as a new payment instead</Button>
          </div>
        </DialogContent>
      </Dialog>
    </form>
  );
}
