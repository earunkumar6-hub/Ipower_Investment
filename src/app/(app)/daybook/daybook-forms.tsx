"use client";

import { LockIcon } from "lucide-react";
import { CashDenominationGrid } from "@/components/cash-denomination-grid";
import { useActionState, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CASH_SOURCE_LABEL, CASH_SOURCES, UPI_ADJUSTMENT_REASONS, type CashSource } from "@/lib/daybook-labels";
import { submitKeepingValues } from "@/lib/form";
import { cn } from "@/lib/utils";
import { closeDayBook, depositToPostOffice, recordAtmWithdrawal, recordOtherIncome, saveCashCount, saveVerification } from "./actions";

const paise = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v.trim()) ? Math.round(Number(v) * 100) : 0);
const inr = (p: number) => (p / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 });

/** Shared result handling; a closed day still lets staff try, so the server's refusal is visible. */
function useDayBookAction(action: (prev: ActionResult, form: FormData) => Promise<ActionResult>, success: string, onSuccess?: () => void) {
  return useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await action(prev, form);
    if (r.ok) {
      toast.success(success);
      onSuccess?.();
    } else toast.error(r.error);
    return r;
  }, { ok: false });
}

function Panel({ title, closed, children }: { title: string; closed: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-xl border bg-white p-4", closed && "bg-slate-50")}>
      <h2 className="mb-3 flex items-center gap-2 font-semibold">{title}{closed && <LockIcon className="size-3.5 text-muted-foreground" aria-label="Closed day" />}</h2>
      {children}
    </div>
  );
}

export function AtmForm({ date, closed }: { date: string; closed: boolean }) {
  const [key, setKey] = useState(0);
  const [state, action, pending] = useDayBookAction(recordAtmWithdrawal, "ATM withdrawal posted (bank → cash)", () => setKey((k) => k + 1));
  return (
    <Panel title="Withdrawal · ATM" closed={closed}>
      <form key={key} onSubmit={submitKeepingValues(action)} className="space-y-3">
        <input type="hidden" name="date" value={date} />
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label htmlFor="atmAmount">Amount</Label><Input id="atmAmount" name="amount" inputMode="decimal" placeholder="18000" /></div>
          <div className="space-y-1.5"><Label htmlFor="atmNotes">Notes</Label><Input id="atmNotes" name="notes" placeholder="For UPI-paid RD" /></div>
        </div>
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
        <Button type="submit" variant="outline" disabled={pending} className="w-full">{pending ? "Saving…" : "Record ATM withdrawal"}</Button>
        <p className="text-xs text-muted-foreground">SBI ••1234 → cash. A transfer, never an expense.</p>
      </form>
    </Panel>
  );
}

/** Other income (interest, incentives…): counted in Profit and Loss. Admin and Super Admin only. */
export function OtherIncomeForm({ date, closed, accounts }: { date: string; closed: boolean; accounts: { id: string; name: string }[] }) {
  const [key, setKey] = useState(0);
  const [state, action, pending] = useDayBookAction(recordOtherIncome, "Other income recorded", () => setKey((k) => k + 1));
  return (
    <Panel title="Other income" closed={closed}>
      <form key={key} onSubmit={submitKeepingValues(action)} className="space-y-3">
        <input type="hidden" name="date" value={date} />
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label htmlFor="oiAmount">Amount</Label><Input id="oiAmount" name="amount" inputMode="decimal" placeholder="2400" /></div>
          <div className="space-y-1.5">
            <Label htmlFor="oiAccount">Received in</Label>
            <NativeSelect id="oiAccount" name="accountId" defaultValue="" className="w-full">
              <NativeSelectOption value="">Pick account</NativeSelectOption>
              {accounts.map((a) => <NativeSelectOption key={a.id} value={a.id}>{a.name}</NativeSelectOption>)}
            </NativeSelect>
          </div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="oiReason">What is it for</Label><Input id="oiReason" name="reason" placeholder="e.g. SBI savings interest, LIC incentive" /></div>
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
        <Button type="submit" variant="outline" disabled={pending} className="w-full">{pending ? "Saving…" : "Record other income"}</Button>
        <p className="text-xs text-muted-foreground">Counted as income in Profit and Loss. Not for premiums or bills collected for others.</p>
      </form>
    </Panel>
  );
}

export function CashCountForm({ date, closed, initial }: { date: string; closed: boolean; initial: Record<string, string> }) {
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [state, action, pending] = useDayBookAction(saveCashCount, "Cash count saved");
  const total = CASH_SOURCES.reduce((t, s) => t + paise(values[s] ?? ""), 0);
  return (
    <Panel title="Cash in hand by source" closed={closed}>
      <form onSubmit={submitKeepingValues(action)} className="space-y-3">
        <input type="hidden" name="date" value={date} />
        <div className="grid grid-cols-2 gap-2">
          {CASH_SOURCES.map((s: CashSource) => (
            <div key={s} className="space-y-1.5">
              <Label htmlFor={`cash-${s}`}>{CASH_SOURCE_LABEL[s]}</Label>
              <Input id={`cash-${s}`} name={s} value={values[s] ?? ""} onChange={(e) => setValues({ ...values, [s]: e.target.value })} inputMode="decimal" placeholder="0" />
            </div>
          ))}
          <div className="space-y-1.5"><Label>Total counted</Label><div className="flex h-8 items-center rounded-lg border bg-slate-50 px-2.5 text-sm font-semibold">{inr(total)}</div></div>
        </div>
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
        <Button type="submit" variant="outline" disabled={pending} className="w-full">{pending ? "Saving…" : "Save cash count"}</Button>
      </form>
    </Panel>
  );
}

type Collected = { id: string; receiptNo: string; customer: string; account: string; amount: string; mode: string; ageDays: number };

export function PoDepositForm({ date, closed, receipts, atmToday, isAdmin }: { date: string; closed: boolean; receipts: Collected[]; atmToday: string; isAdmin: boolean }) {
  const [ticked, setTicked] = useState<string[]>([]);
  const [amount, setAmount] = useState("");
  const [key, setKey] = useState(0);
  const [state, action, pending] = useDayBookAction(depositToPostOffice, "Deposit saved; receipts marked Deposited", () => {
    setTicked([]);
    setAmount("");
    setKey((k) => k + 1);
  });
  const selected = receipts.filter((r) => ticked.includes(r.id));
  const total = selected.reduce((t, r) => t + paise(r.amount), 0);
  const upi = selected.filter((r) => r.mode !== "Cash").reduce((t, r) => t + paise(r.amount), 0);
  const atm = paise(atmToday);
  const deposited = amount ? paise(amount) : total;
  const amountGap = deposited - total;
  const upiGap = upi - atm;
  const toggle = (id: string, on: boolean) => setTicked(on ? [...ticked, id] : ticked.filter((x) => x !== id));

  return (
    <Panel title="Deposit to · Post Office" closed={closed}>
      <form key={key} onSubmit={submitKeepingValues(action)} className="space-y-3">
        <input type="hidden" name="date" value={date} />
        <input type="hidden" name="receiptIds" value={ticked.join(",")} />
        <input type="hidden" name="amount" value={(deposited / 100).toFixed(2)} />
        <div className="max-h-56 overflow-y-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs text-muted-foreground">
              <tr>
                <th className="w-8 p-2"><input type="checkbox" aria-label="Tick all" checked={receipts.length > 0 && ticked.length === receipts.length} onChange={(e) => setTicked(e.target.checked ? receipts.map((r) => r.id) : [])} /></th>
                <th className="p-2 text-left">Receipt</th><th className="p-2 text-left">Customer</th><th className="p-2 text-left">RD account</th><th className="p-2 text-left">Paid by</th><th className="p-2 text-right">Amount</th><th className="p-2 text-right">Age</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2"><input type="checkbox" aria-label={`Deposit ${r.receiptNo}`} checked={ticked.includes(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} /></td>
                  <td className="p-2">{r.receiptNo}</td><td className="p-2">{r.customer}</td><td className="p-2">{r.account}</td><td className="p-2">{r.mode}</td>
                  <td className="p-2 text-right">{inr(paise(r.amount))}</td>
                  <td className={cn("p-2 text-right", r.ageDays > 0 && "font-medium text-orange-700")}>{r.ageDays ? `${r.ageDays} d` : "today"}</td>
                </tr>
              ))}
              {receipts.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No RD money waiting to be deposited.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-4 gap-2 text-sm">
          <Stat label="Selected" value={`${selected.length} · ${inr(total)}`} />
          <Stat label="Paid by UPI" value={inr(upi)} sub="needs cash from ATM" />
          <Stat label="ATM withdrawn today" value={inr(atm)} />
          <Stat label="UPI vs ATM" value={inr(upiGap)} warn={upiGap !== 0 && selected.length > 0} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1.5"><Label htmlFor="poReceiptNo">Post office receipt no.</Label><Input id="poReceiptNo" name="poReceiptNo" placeholder="7781 2290" /></div>
          <div className="space-y-1.5"><Label htmlFor="depAmount">Amount deposited</Label><Input id="depAmount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={inr(total)} inputMode="decimal" /></div>
          <div className="space-y-1.5">
            <Label htmlFor="upiReason">If UPI ≠ ATM, why?</Label>
            <NativeSelect id="upiReason" name="upiReason" className="w-full" defaultValue="">
              <NativeSelectOption value="">No difference</NativeSelectOption>
              {UPI_ADJUSTMENT_REASONS.map((r) => <NativeSelectOption key={r} value={r}>{r}</NativeSelectOption>)}
            </NativeSelect>
          </div>
        </div>
        {amountGap !== 0 && selected.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="amountReason">Deposited ≠ ticked by {inr(amountGap)}: reason {isAdmin ? "(required)" : "(Admin only)"}</Label>
            <Input id="amountReason" name="amountReason" disabled={!isAdmin} />
          </div>
        )}
        {selected.length > 0 && <CashDenominationGrid amount={deposited} idPrefix="po" />}
        <Input name="note" placeholder="Note (optional)" />
        {state.error && <p className="text-xs text-destructive">{state.error}</p>}
        <Button type="submit" disabled={pending || selected.length === 0} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save deposit"}</Button>
      </form>
    </Panel>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-2", warn && "border-orange-300 bg-orange-50")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function VerifyCloseForm(p: { date: string; closed: boolean; admins: { id: string; name: string }[]; verifiedById: string | null; canVerify: boolean; canClose: boolean; ready: boolean }) {
  const [vState, verify, verifying] = useDayBookAction(saveVerification, "Verification saved");
  const [cState, close, closing] = useDayBookAction(closeDayBook, "Day Book closed");
  return (
    <Panel title="Verify and close" closed={p.closed}>
      <form onSubmit={submitKeepingValues(verify)} className="mb-3 flex items-end gap-2">
        <input type="hidden" name="date" value={p.date} />
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="verifiedById">Verified by</Label>
          <NativeSelect id="verifiedById" name="verifiedById" className="w-full" defaultValue={p.verifiedById ?? ""} disabled={!p.canVerify}>
            <NativeSelectOption value="">Pick…</NativeSelectOption>
            {p.admins.map((a) => <NativeSelectOption key={a.id} value={a.id}>{a.name}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        {p.canVerify && <Button type="submit" variant="outline" disabled={verifying}>{verifying ? "Saving…" : "Save verification"}</Button>}
      </form>
      {vState.error && <p className="mb-2 text-xs text-destructive">{vState.error}</p>}
      <form onSubmit={submitKeepingValues(close)}>
        <input type="hidden" name="date" value={p.date} />
        {p.canClose && (
          <Button type="submit" disabled={closing || p.closed || !p.ready} className="w-full bg-brand-600 hover:bg-brand-700">
            {p.closed ? "Closed" : closing ? "Closing…" : "Close Day Book"}
          </Button>
        )}
      </form>
      {cState.error && <p className="mt-2 text-xs text-destructive">{cState.error}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        Only Admin and Super Admin can verify and close. Closing is allowed only when TALLIED and verified, and earlier days are closed.
      </p>
    </Panel>
  );
}
