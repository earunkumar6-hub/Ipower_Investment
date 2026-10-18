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
import { cn } from "@/lib/utils";
import { createReceipt } from "../actions";

export type PolicyOption = { id: string; label: string; items: { id: string; amount: string; label: string }[] };
type Slip = { id: string; slipNo: string; account: string; month: string; amount: string; poReceiptNo: string };

const MODES = ["Cash", "UPI", "Cheque"] as const;
const paise = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : 0);
const inr = (p: number) => (p / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: p % 100 ? 2 : 0 });

export function ReceiptForm({ customer, policies, openSlips }: { customer: { id: string; name: string; mobile: string }; policies: PolicyOption[]; openSlips: Slip[] }) {
  const router = useRouter();
  // With owner-paid slips open the payment is usually for them, so start blank.
  const first = openSlips.length ? undefined : (policies.find((p) => p.items.length) ?? policies[0]);
  const [policyId, setPolicyId] = useState(first?.id ?? "");
  const [itemId, setItemId] = useState(first?.items[0]?.id ?? "");
  const [amount, setAmount] = useState(first?.items[0]?.amount ?? "");
  const [mode, setMode] = useState<(typeof MODES)[number]>("Cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [popup, setPopup] = useState(false);
  const [ticked, setTicked] = useState<string[]>(openSlips.map((s) => s.id));

  const [state, dispatch, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await createReceipt(prev, form);
    if (r.ok) {
      toast.success("Receipt saved and sent to the customer");
      router.push(`/receipts/${r.id}`);
    } else setPopup(false);
    return r;
  }, { ok: false });

  const policy = policies.find((p) => p.id === policyId);
  const item = policy?.items.find((i) => i.id === itemId);

  function submit(slipIds: string[]) {
    const form = new FormData();
    Object.entries({ customerId: customer.id, policyId, renewalItemId: slipIds.length ? "" : itemId, amount, mode, reference, notes, slipIds: slipIds.join(",") })
      .forEach(([k, v]) => form.set(k, v));
    startTransition(() => dispatch(form));
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    // Owner already paid some instalments for this customer: ask before recording a fresh payment.
    if (openSlips.length) setPopup(true);
    else submit([]);
  }

  const selected = openSlips.filter((s) => ticked.includes(s.id)).reduce((t, s) => t + paise(s.amount), 0);
  const diff = paise(amount) - selected;
  const err = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSave} className="max-w-2xl space-y-4 rounded-xl border bg-white p-4">
      <div>
        <h2 className="font-semibold">{customer.name}</h2>
        <p className="text-xs text-muted-foreground">{customer.mobile}{openSlips.length > 0 && ` · ${openSlips.length} owner-paid instalment(s) open`}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="policyId">Policy / account</Label>
          <NativeSelect id="policyId" value={policyId} className="w-full" aria-invalid={!!err.policyId} onChange={(e) => {
            const p = policies.find((x) => x.id === e.target.value);
            setPolicyId(e.target.value);
            setItemId(p?.items[0]?.id ?? "");
            setAmount(p?.items[0]?.amount ?? "");
          }}>
            <NativeSelectOption value="">Pick…</NativeSelectOption>
            {policies.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.label}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="itemId">Instalment / renewal</Label>
          <NativeSelect id="itemId" value={itemId} className="w-full" onChange={(e) => {
            setItemId(e.target.value);
            const i = policy?.items.find((x) => x.id === e.target.value);
            if (i) setAmount(i.amount);
          }}>
            <NativeSelectOption value="">None (other payment)</NativeSelectOption>
            {policy?.items.map((i) => <NativeSelectOption key={i.id} value={i.id}>{i.label} · {inr(paise(i.amount))}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="amount">Amount (₹)</Label>
          <Input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} readOnly={!!item} inputMode="decimal" aria-invalid={!!err.amount} />
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
        {mode === "Cash" ? "Goes into cash in hand." : "Goes into SBI current ••1234."} RD instalments are marked Collected until deposited at the post office.
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
