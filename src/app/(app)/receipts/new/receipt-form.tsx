"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, startTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isoDate, istToday } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { createReceipt } from "../actions";

/** `dues`: payable instalments oldest first (unpaid, then advance up to 12 months ahead). */
export type PolicyOption = { id: string; label: string; dues: { label: string; amount: string; tag: "Overdue" | "Due" | "Advance" }[] };
type Slip = { id: string; slipNo: string; account: string; month: string; amount: string; poReceiptNo: string };

const MODES = ["Cash", "UPI", "Cheque"] as const;
const paise = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : 0);
const inr = (p: number) => (p / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: p % 100 ? 2 : 0 });
const TAG_STYLE = { Overdue: "text-destructive", Due: "text-foreground", Advance: "text-blue-700" };

export function ReceiptForm({ customer, policies, openSlips }: { customer: { id: string; name: string; mobile: string }; policies: PolicyOption[]; openSlips: Slip[] }) {
  const router = useRouter();
  // With owner-paid slips open the payment is usually for them, so start blank; otherwise the earliest due.
  const first = openSlips.length ? undefined : policies.find((p) => p.dues.length);
  const [counts, setCounts] = useState<Record<string, number>>(first ? { [first.id]: 1 } : {});
  const [otherPolicyId, setOtherPolicyId] = useState("");
  const [otherAmount, setOtherAmount] = useState("");
  const [mode, setMode] = useState<(typeof MODES)[number]>("Cash");
  const [reference, setReference] = useState("");
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

  const picked = policies.filter((p) => (counts[p.id] ?? 0) > 0);
  const duesTotal = picked.reduce((t, p) => t + p.dues.slice(0, counts[p.id]).reduce((s, d) => s + paise(d.amount), 0), 0);
  const dueCount = picked.reduce((t, p) => t + counts[p.id], 0);
  const amount = dueCount ? (duesTotal / 100).toFixed(2) : otherAmount;

  function submit(slipIds: string[]) {
    const form = new FormData();
    const dues = slipIds.length ? [] : picked.map((p) => ({ policyId: p.id, count: counts[p.id] }));
    Object.entries({
      customerId: customer.id, policyId: dues.length ? "" : otherPolicyId, dues: dues.length ? JSON.stringify(dues) : "",
      amount, mode, reference, notes, slipIds: slipIds.join(","), receiptDate, txnDate,
    }).forEach(([k, v]) => form.set(k, v));
    startTransition(() => dispatch(form));
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    // Owner already paid some instalments for this customer: ask before recording a fresh payment.
    if (openSlips.length) setPopup(true);
    else submit([]);
  }

  const range = (p: PolicyOption, n: number) => (n === 1 ? p.dues[0].label : `${p.dues[0].label} – ${p.dues[n - 1].label}`);
  const selected = openSlips.filter((s) => ticked.includes(s.id)).reduce((t, s) => t + paise(s.amount), 0);
  const diff = paise(amount) - selected;
  const err = state.fieldErrors ?? {};
  const withDues = policies.filter((p) => p.dues.length);

  return (
    <form onSubmit={onSave} className="max-w-3xl space-y-4 rounded-xl border bg-white p-4">
      <div>
        <h2 className="font-semibold">{customer.name}</h2>
        <p className="text-xs text-muted-foreground">{customer.mobile}{openSlips.length > 0 && ` · ${openSlips.length} owner-paid instalment(s) open`}</p>
      </div>

      {withDues.length > 0 && (
        <div className="space-y-1.5">
          <Label>Dues to pay</Label>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Policy / account</TableHead><TableHead>Next due</TableHead><TableHead>Instalments</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {withDues.map((p) => {
                const n = counts[p.id] ?? 0;
                const next = p.dues[0];
                return (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-normal">{p.label}</TableCell>
                    <TableCell>{next.label} <span className={cn("text-xs", TAG_STYLE[next.tag])}>{next.tag}</span></TableCell>
                    <TableCell>
                      <NativeSelect aria-label={`Instalments for ${p.label}`} value={String(n)} className="w-56"
                        onChange={(e) => setCounts({ ...counts, [p.id]: Number(e.target.value) })}>
                        <NativeSelectOption value="0">None</NativeSelectOption>
                        {p.dues.map((d, i) => (
                          <NativeSelectOption key={i} value={String(i + 1)}>{i + 1} · {range(p, i + 1)}{d.tag === "Advance" ? " (advance)" : ""}</NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </TableCell>
                    <TableCell className="text-right">{n ? inr(p.dues.slice(0, n).reduce((s, d) => s + paise(d.amount), 0)) : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Oldest dues are paid first; advance up to 12 months ahead.
            {dueCount > 1 && ` ${dueCount} dues → one payment receipt for the customer, with a receipt line per due.`}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {dueCount === 0 && (
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="policyId">{withDues.length ? "Or another payment – policy / account" : "Policy / account"}</Label>
            <NativeSelect id="policyId" value={otherPolicyId} className="w-full" aria-invalid={!!err.policyId} onChange={(e) => setOtherPolicyId(e.target.value)}>
              <NativeSelectOption value="">Pick…</NativeSelectOption>
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
          <Label htmlFor="amount">Amount (₹)</Label>
          <Input id="amount" value={amount} onChange={(e) => setOtherAmount(e.target.value)} readOnly={dueCount > 0} inputMode="decimal" aria-invalid={!!err.amount} />
        </div>
        <div className="space-y-1.5">
          <Label>Mode</Label>
          <div className="flex gap-2">
            {MODES.map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={cn("h-8 flex-1 rounded-lg border text-sm", mode === m ? "border-blue-600 bg-blue-50 font-medium text-blue-700" : "hover:bg-slate-50")}>
                {m}
              </button>
            ))}
          </div>
        </div>
        {mode !== "Cash" && (
          <div className="space-y-1.5">
            <Label htmlFor="reference">{mode === "UPI" ? "UTR" : "Cheque no."}</Label>
            <Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} aria-invalid={!!err.reference} />
          </div>
        )}
        <div className={cn("space-y-1.5", mode === "Cash" && "col-span-2")}>
          <Label htmlFor="notes">Notes</Label>
          <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {mode === "Cash" ? "Goes into cash in hand." : "Goes into SBI current ••1234."} The Day Book records it on the bill date. RD instalments are marked Collected until deposited at the post office.
      </p>
      {state.error && !popup && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="bg-blue-600 hover:bg-blue-700">{pending ? "Saving…" : "Save receipt"}</Button>

      <Dialog open={popup} onOpenChange={setPopup}>
        <DialogContent className="sm:max-w-xl">
          <span className="w-fit rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">Owner-paid renewals found</span>
          <DialogTitle className="text-lg font-semibold">{customer.name} paid {inr(paise(amount))} ({mode})</DialogTitle>
          <DialogDescription>The owner already paid these RD instalments at the post office. Adjust this payment against them?</DialogDescription>
          <Table>
            <TableHeader>
              <TableRow><TableHead /><TableHead>Slip</TableHead><TableHead>RD account</TableHead><TableHead>Month</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>PO receipt no.</TableHead></TableRow>
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
          <p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-900">
            On adjusting: a customer receipt is created and sent; the ticked slips close automatically against it (no separate owner invoice remains),
            and the money moves to &quot;Return to owner&quot;. It is not added to the post office deposit list.
          </p>
          {state.error && popup && <p className="text-sm text-destructive">{state.error}</p>}
          <div className="flex gap-2">
            <Button type="button" disabled={pending || diff !== 0 || !ticked.length} className="bg-blue-600 hover:bg-blue-700" onClick={() => submit(ticked)}>
              Adjust and create receipt
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => submit([])}>Record as a new payment instead</Button>
          </div>
        </DialogContent>
      </Dialog>
    </form>
  );
}
