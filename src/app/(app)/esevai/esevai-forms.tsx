"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { CashDenominationGrid } from "@/components/cash-denomination-grid";
import { Button } from "@/components/ui/button";
import { DmyDateInput } from "@/components/dmy-date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { isoDate, istNowHHMM, istToday } from "@/lib/dates";
import { submitKeepingValues } from "@/lib/form";
import { createServiceEntry, findCustomerByMobile, rechargeWallet } from "./actions";

type Rate = { min: string | null; max: string | null; charge: string | null; cost: string | null; customer: string | null };
export type ServiceOption = { code: string; name: string; walletId: string; allowBankPay: boolean; rates: Rate[] };
type Opt = { id: string; label: string };

const paise = (v: string | null) => (v && /^\d+(\.\d{1,2})?$/.test(v.trim()) ? Math.round(Number(v) * 100) : 0);
const rupees = (p: number) => (p / 100).toFixed(p % 100 ? 2 : 0);
const inr = (p: number) => (p / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: p % 100 ? 2 : 0 });

/** The rate table's suggestion (#7: staff may change it): fixed services → cost + customer amount; EB slab → bill + charge. */
function suggest(s: ServiceOption, paid: string): { paid?: number; collected?: number } {
  const fixed = s.rates.find((r) => r.customer);
  if (fixed) return { paid: paise(fixed.cost), collected: paise(fixed.customer) };
  const b = paise(paid);
  const slab = b ? s.rates.find((r) => b >= paise(r.min) && b <= paise(r.max)) : undefined;
  return slab ? { collected: b + paise(slab.charge) } : {};
}

/** New ESEVAI & CSC entry (#7). Save only – no receipt opens (owner change list, #16). */
export function ServiceEntryForm({ services, wallets, banks }: { services: ServiceOption[]; wallets: Opt[]; banks: Opt[] }) {
  const [key, setKey] = useState(0);
  return <EntryForm key={key} services={services} wallets={wallets} banks={banks} onSaved={() => setKey((k) => k + 1)} />;
}

function EntryForm({ services, wallets, banks, onSaved }: { services: ServiceOption[]; wallets: Opt[]; banks: Opt[]; onSaved: () => void }) {
  const today = isoDate(istToday());
  const [time, setTime] = useState(""); // the current time, filled in once the form is on screen
  useEffect(() => setTime(istNowHHMM()), []);
  const [code, setCode] = useState(services[0]?.code ?? "EB");
  const service = services.find((s) => s.code === code)!;
  /** The service's own wallet if it is still active, else the first wallet. */
  const walletFor = (s: ServiceOption) => (wallets.some((w) => w.id === s.walletId) ? s.walletId : wallets[0]?.id ?? "");
  const [paid, setPaid] = useState(() => { const g = suggest(service, ""); return g.paid ? rupees(g.paid) : ""; });
  const [collected, setCollected] = useState("");
  const [touched, setTouched] = useState(false); // staff changed "collected": stop prefilling it
  const [paidVia, setPaidVia] = useState<"Wallet" | "GPay" | "NetBanking">("Wallet");
  const [paidFrom, setPaidFrom] = useState(() => walletFor(service));
  const [mode, setMode] = useState<"Cash" | "UPI">("Cash");
  const [mobile, setMobile] = useState("");
  const [match, setMatch] = useState<{ id: string; name: string; cifNo: string } | null>(null);

  // A new service: its default wallet, and the rate table's amounts.
  function pickService(next: string) {
    const s = services.find((x) => x.code === next)!;
    setCode(next);
    setPaidVia("Wallet");
    setPaidFrom(walletFor(s));
    const g = suggest(s, "");
    setPaid(g.paid ? rupees(g.paid) : "");
    setTouched(false);
    setCollected(g.collected ? rupees(g.collected) : "");
  }
  useEffect(() => {
    if (touched) return;
    const g = suggest(service, paid);
    if (g.collected) setCollected(rupees(g.collected));
  }, [paid, service, touched]);
  useEffect(() => {
    if (!/^[6-9]\d{9}$/.test(mobile)) return setMatch(null);
    let live = true;
    findCustomerByMobile(mobile).then((c) => live && setMatch(c));
    return () => { live = false; };
  }, [mobile]);

  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await createServiceEntry(prev, form);
    if (r.ok) {
      toast.success(`${service.name} saved`);
      onSaved();
    }
    return r;
  }, { ok: false });
  const err = state.fieldErrors ?? {};
  const profit = paise(collected) - paise(paid);
  const direct = paidVia !== "Wallet";

  return (
    <form onSubmit={submitKeepingValues(action)} className="w-[30rem] shrink-0 space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">New ESEVAI &amp; CSC entry</h2>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="txnDate">Date</Label>
          <DmyDateInput name="txnDate" defaultValue={today} max={today} required aria-invalid={!!err.txnDate} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="txnTime">Time</Label>
          <Input id="txnTime" name="txnTime" type="time" value={time} onChange={(e) => setTime(e.target.value)} required aria-invalid={!!err.txnTime} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="serviceCode">Service</Label>
          <NativeSelect id="serviceCode" name="serviceCode" value={code} onChange={(e) => pickService(e.target.value)} className="w-full">
            {services.map((s) => <NativeSelectOption key={s.code} value={s.code}>{s.code === "OTHER" ? "Other" : s.name}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        {code === "OTHER" ? (
          <div className="space-y-1.5"><Label htmlFor="serviceName">Service name</Label><Input id="serviceName" name="serviceName" aria-invalid={!!err.serviceName} /></div>
        ) : <input type="hidden" name="serviceName" value="" />}
        <div className="space-y-1.5">
          <Label htmlFor="providerRef">{code === "EB" ? "Consumer / service no." : "Service / application no."}</Label>
          <Input id="providerRef" name="providerRef" aria-invalid={!!err.providerRef} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customerMobile">Mobile</Label>
          <Input id="customerMobile" name="customerMobile" value={mobile} onChange={(e) => setMobile(e.target.value.trim())} inputMode="numeric" maxLength={10} aria-invalid={!!err.customerMobile} />
          {match && <p className="text-xs text-green-700">Matches customer <Link href={`/customers/${match.id}`} className="underline" target="_blank">{match.name}</Link></p>}
        </div>
        <div className="space-y-1.5"><Label htmlFor="customerName">Name</Label><Input id="customerName" name="customerName" placeholder={match?.name} /></div>
        <div className="space-y-1.5">
          <Label htmlFor="gender">Gender</Label>
          <NativeSelect id="gender" name="gender" defaultValue="" className="w-full">
            <NativeSelectOption value="">—</NativeSelectOption>
            <NativeSelectOption value="Female">Female</NativeSelectOption>
            <NativeSelectOption value="Male">Male</NativeSelectOption>
            <NativeSelectOption value="Other">Other</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="paidAmount">{code === "EB" ? "EB amount paid" : "Amount paid / deducted"}</Label>
          <Input id="paidAmount" name="paidAmount" value={paid} onChange={(e) => setPaid(e.target.value)} inputMode="decimal" aria-invalid={!!err.paidAmount} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="paidVia">Paid from</Label>
          <NativeSelect id="paidVia" value={direct ? `${paidVia}` : paidFrom} className="w-full" aria-invalid={!!err.paidFromAccountId}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "GPay" || val === "NetBanking") { setPaidVia(val); setPaidFrom(banks[0]?.id ?? ""); } else { setPaidVia("Wallet"); setPaidFrom(val); }
            }}>
            {wallets.map((w) => <NativeSelectOption key={w.id} value={w.id}>{w.label}</NativeSelectOption>)}
            {service.allowBankPay && <NativeSelectOption value="GPay">GPay direct</NativeSelectOption>}
            {service.allowBankPay && <NativeSelectOption value="NetBanking">Net banking direct</NativeSelectOption>}
          </NativeSelect>
          <input type="hidden" name="paidVia" value={paidVia} />
          {!direct && <input type="hidden" name="paidFromAccountId" value={paidFrom} />}
        </div>
        {direct && (
          <div className="space-y-1.5">
            <Label htmlFor="paidFromAccountId">From bank account</Label>
            <NativeSelect id="paidFromAccountId" name="paidFromAccountId" value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} className="w-full">
              {banks.map((b) => <NativeSelectOption key={b.id} value={b.id}>{b.label}</NativeSelectOption>)}
            </NativeSelect>
          </div>
        )}
        <div className="space-y-1.5"><Label htmlFor="providerTxnNo">Transaction no. <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="providerTxnNo" name="providerTxnNo" aria-invalid={!!err.providerTxnNo} /></div>
        <div className="space-y-1.5">
          <Label htmlFor="collected">Collected from customer</Label>
          <Input id="collected" name="collected" value={collected} onChange={(e) => { setTouched(true); setCollected(e.target.value); }} inputMode="decimal" aria-invalid={!!err.collected} />
          {paise(collected) > 0 && <p className={profit < 0 ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>Service charge {inr(profit)}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mode">Collected by</Label>
          <NativeSelect id="mode" name="mode" value={mode} onChange={(e) => setMode(e.target.value as "Cash" | "UPI")} className="w-full">
            <NativeSelectOption value="Cash">Cash</NativeSelectOption>
            <NativeSelectOption value="UPI">UPI</NativeSelectOption>
          </NativeSelect>
        </div>
        {mode === "UPI" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="intoAccountId">Received into</Label>
              <NativeSelect id="intoAccountId" name="intoAccountId" defaultValue={banks[0]?.id ?? ""} className="w-full" aria-invalid={!!err.intoAccountId}>
                {banks.map((b) => <NativeSelectOption key={b.id} value={b.id}>{b.label}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="space-y-1.5"><Label htmlFor="reference">UTR (optional)</Label><Input id="reference" name="reference" /></div>
          </>
        )}
      </div>
      {mode === "Cash" && <CashDenominationGrid amount={paise(collected)} idPrefix="sv" error={err.denominations} />}
      <div className="space-y-1.5"><Label htmlFor="svNotes">Notes</Label><Input id="svNotes" name="notes" /></div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending || !paise(paid) || !paise(collected)} className="w-full bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save"}</Button>
      <p className="text-xs text-muted-foreground">Change the amounts if the customer paid a different amount. Service charge = collected − paid.</p>
    </form>
  );
}

/** Admin / Super Admin: recharge a wallet from a company bank account (transaction no. required). */
export function RechargeForm({ wallets, banks }: { wallets: Opt[]; banks: Opt[] }) {
  const [formKey, setFormKey] = useState(0);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await rechargeWallet(prev, form);
    if (r.ok) {
      toast.success("Wallet recharged; Day Book updated");
      setFormKey((k) => k + 1);
    }
    return r;
  }, { ok: false });

  return (
    <form key={formKey} onSubmit={submitKeepingValues(action)} className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4">
      <div className="space-y-1.5">
        <Label htmlFor="walletId">Recharge wallet</Label>
        <NativeSelect id="walletId" name="walletId">
          {wallets.map((w) => <NativeSelectOption key={w.id} value={w.id}>{w.label}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rechargeAmount">Amount</Label>
        <Input id="rechargeAmount" name="amount" inputMode="decimal" className="w-28" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="bankAccountId">From bank account</Label>
        <NativeSelect id="bankAccountId" name="bankAccountId">
          {banks.map((b) => <NativeSelectOption key={b.id} value={b.id}>{b.label}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rechargeRef">Transaction no.</Label>
        <Input id="rechargeRef" name="reference" className="w-32" />
      </div>
      <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Recharge"}</Button>
      {state.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
