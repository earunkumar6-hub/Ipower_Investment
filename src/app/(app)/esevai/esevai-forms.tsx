"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { submitKeepingValues } from "@/lib/form";
import { createServiceEntry, rechargeWallet } from "./actions";

type Rate = { min: string | null; max: string | null; charge: string | null; cost: string | null; customer: string | null };
export type ServiceOption = { code: string; name: string; walletName: string; allowBankPay: boolean; rates: Rate[] };

// Display-only preview; the server recomputes from the same rates.
const paise = (v: string | null) => (v && /^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : 0);
const inr = (p: number) => (p / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: p % 100 ? 2 : 0 });

function preview(s: ServiceOption, base: string): { customer: number; cost: number } | "no-rate" | null {
  const fixed = s.rates.find((r) => r.customer);
  if (fixed) return { customer: paise(fixed.customer), cost: paise(fixed.cost) };
  const b = paise(base);
  if (!b) return null;
  const slab = s.rates.find((r) => b >= paise(r.min) && b <= paise(r.max));
  return slab ? { customer: b + paise(slab.charge), cost: b } : "no-rate";
}

export function ServiceEntryForm({ services }: { services: ServiceOption[] }) {
  const [code, setCode] = useState(services[0]?.code ?? "EB");
  const [base, setBase] = useState("");
  const [mode, setMode] = useState<"Cash" | "UPI">("Cash");
  const [formKey, setFormKey] = useState(0);
  const service = services.find((s) => s.code === code)!;
  const p = preview(service, base);

  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await createServiceEntry(prev, form);
    if (r.ok) {
      toast.success(`${service.name} saved`);
      setBase("");
      setFormKey((k) => k + 1); // clear the other inputs
    }
    return r;
  }, { ok: false });
  const err = state.fieldErrors ?? {};

  return (
    <form key={formKey} onSubmit={submitKeepingValues(action)} className="w-[28rem] shrink-0 space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">New E-Sevai entry</h2>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="serviceCode">Service</Label>
          <NativeSelect id="serviceCode" name="serviceCode" value={code} onChange={(e) => setCode(e.target.value)} className="w-full">
            {services.map((s) => <NativeSelectOption key={s.code} value={s.code}>{s.name}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        {code === "EB" ? (
          <div className="space-y-1.5">
            <Label htmlFor="baseAmount">EB amount paid</Label>
            <Input id="baseAmount" name="baseAmount" value={base} onChange={(e) => setBase(e.target.value)} inputMode="decimal" placeholder="850" aria-invalid={!!err.baseAmount} />
          </div>
        ) : (
          <input type="hidden" name="baseAmount" value="" />
        )}
        <div className="space-y-1.5">
          <Label htmlFor="paidFrom">Paid from</Label>
          <NativeSelect id="paidFrom" name="paidFrom" className="w-full" disabled={!service.allowBankPay} defaultValue="wallet">
            <NativeSelectOption value="wallet">{service.walletName}</NativeSelectOption>
            {service.allowBankPay && <NativeSelectOption value="bank">SBI current ••1234</NativeSelectOption>}
          </NativeSelect>
          {!service.allowBankPay && <input type="hidden" name="paidFrom" value="wallet" />}
        </div>
        <div className="space-y-1.5">
          <Label>Collected from customer</Label>
          <div className="flex h-8 items-center rounded-lg border bg-slate-50 px-2.5 text-sm font-medium">
            {p === "no-rate" ? <span className="text-destructive">No rate for this amount</span> : p ? inr(p.customer) : "—"}
          </div>
          {p && p !== "no-rate" && <p className="text-xs text-muted-foreground">Provider {inr(p.cost)} · profit {inr(p.customer - p.cost)}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mode">Collected by</Label>
          <NativeSelect id="mode" name="mode" value={mode} onChange={(e) => setMode(e.target.value as "Cash" | "UPI")} className="w-full">
            <NativeSelectOption value="Cash">Cash</NativeSelectOption>
            <NativeSelectOption value="UPI">UPI</NativeSelectOption>
          </NativeSelect>
        </div>
        {mode === "UPI" ? (
          <div className="space-y-1.5">
            <Label htmlFor="reference">UTR (optional)</Label>
            <Input id="reference" name="reference" />
          </div>
        ) : (
          <input type="hidden" name="reference" value="" />
        )}
        <div className="space-y-1.5">
          <Label htmlFor="providerRef">{code === "EB" ? "Consumer / reference no." : "Application / reference no."}</Label>
          <Input id="providerRef" name="providerRef" placeholder={code === "EB" ? "TNEB-55821" : "PAN-77120"} aria-invalid={!!err.providerRef} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customerName">Customer name (optional)</Label>
          <Input id="customerName" name="customerName" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customerMobile">Mobile (optional)</Label>
          <Input id="customerMobile" name="customerMobile" inputMode="numeric" maxLength={10} aria-invalid={!!err.customerMobile} />
        </div>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending || p === "no-rate"} className="w-full bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save entry"}</Button>
    </form>
  );
}

export function RechargeForm({ wallets }: { wallets: { id: string; name: string }[] }) {
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
          {wallets.map((w) => <NativeSelectOption key={w.id} value={w.id}>{w.name}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rechargeAmount">Amount</Label>
        <Input id="rechargeAmount" name="amount" inputMode="decimal" className="w-28" placeholder="2000" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="from">From</Label>
        <NativeSelect id="from" name="from">
          <NativeSelectOption value="Bank">SBI ••1234</NativeSelectOption>
          <NativeSelectOption value="Cash">Cash</NativeSelectOption>
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rechargeRef">Reference</Label>
        <Input id="rechargeRef" name="reference" className="w-32" placeholder="UTR" />
      </div>
      <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Recharge"}</Button>
      {state.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
