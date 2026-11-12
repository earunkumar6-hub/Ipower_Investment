"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { type Cash, cashJson, cashTotal, DenominationInputs, inr, paise } from "@/components/cash-denomination-grid";
import { NET_TYPES, REFERENCE_LABEL, type PayModeOption, type ReceiptMode } from "@/lib/payment-modes";
import { cn } from "@/lib/utils";

/** `mode` is the built-in mode; `modeName` the agency's own mode picked ("" for a built-in one). */
export type PayValue = { mode: ReceiptMode; modeName: string; reference: string; bankName: string; netType: string; notes: Record<string, string>; coins: string; change?: Cash["change"]; intoAccountId: string };
/** A bank account for the "Received into" picker. */
export type IntoAccount = { id: string; label: string };
/** `accounts[0]` (the default bank) is picked to start with. */
export const emptyPay = (modes: PayModeOption[], accounts: IntoAccount[] = []): PayValue =>
  ({ mode: modes[0]?.mode ?? "Cash", modeName: modes[0]?.name ?? "", reference: "", bankName: "", netType: "", notes: {}, coins: "", intoAccountId: accounts[0]?.id ?? "" });

export { cashTotal, inr, paise };

/** Form fields sent to the server: mode (+ modeName for the agency's own mode), reference, bankName + netType (net banking), the denomination as JSON (cash only), received into (not cash). */
export function payFormFields(v: PayValue): Record<string, string> {
  const cash = v.mode === "Cash";
  return {
    mode: v.mode, modeName: v.modeName, reference: cash ? "" : v.reference, bankName: v.mode === "NetBanking" ? v.bankName : "", netType: v.mode === "NetBanking" ? v.netType : "",
    denominations: cash ? cashJson(v) : "", intoAccountId: cash ? "" : v.intoAccountId,
  };
}

/**
 * Mode buttons, then what the mode needs: cash denomination, or UTR / transaction ID / cheque no., the customer's bank
 * and the company bank account it was received into (`accounts`: active bank accounts, default first).
 */
export function PaymentFields({ modes, accounts, amount, value, onChange, errors = {} }: {
  modes: PayModeOption[]; accounts: IntoAccount[]; amount: number; value: PayValue; onChange: (v: PayValue) => void; errors?: Record<string, string>;
}) {
  const set = (patch: Partial<PayValue>) => onChange({ ...value, ...patch });
  return (
    <div className="col-span-2 space-y-3">
      <div className="space-y-1.5">
        <Label>Payment mode</Label>
        <div className="flex flex-wrap gap-2">
          {modes.map((m) => (
            <button key={m.name ?? m.mode} type="button" onClick={() => set({ mode: m.mode, modeName: m.name ?? "" })}
              className={cn("h-8 min-w-24 flex-1 rounded-lg border px-2 text-sm", value.mode === m.mode && value.modeName === (m.name ?? "") ? "border-brand-600 bg-saffron-50 font-medium text-brand-700" : "hover:bg-slate-50")}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {value.mode === "Cash" ? (
        <DenominationInputs value={value} onChange={(c) => set(c)} amount={amount} error={errors.denominations} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {value.mode === "NetBanking" && (
            <div className="space-y-1.5">
              <Label htmlFor="netType">Transfer type</Label>
              <NativeSelect id="netType" value={value.netType} className="w-full" aria-invalid={!!errors.netType} onChange={(e) => set({ netType: e.target.value })}>
                <NativeSelectOption value=""></NativeSelectOption>
                {NET_TYPES.map((t) => <NativeSelectOption key={t} value={t}>{t}</NativeSelectOption>)}
              </NativeSelect>
            </div>
          )}
          {value.mode === "NetBanking" && (
            <div className="space-y-1.5">
              <Label htmlFor="bankName">Customer&apos;s bank</Label>
              <Input id="bankName" value={value.bankName} maxLength={60} aria-invalid={!!errors.bankName} onChange={(e) => set({ bankName: e.target.value })} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="reference">{REFERENCE_LABEL[value.mode]}</Label>
            <Input id="reference" value={value.reference} onChange={(e) => set({ reference: e.target.value })} aria-invalid={!!errors.reference} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="intoAccountId">Received into</Label>
            <NativeSelect id="intoAccountId" value={value.intoAccountId} className="w-full" aria-invalid={!!errors.intoAccountId} onChange={(e) => set({ intoAccountId: e.target.value })}>
              <NativeSelectOption value=""></NativeSelectOption>
              {accounts.map((a) => <NativeSelectOption key={a.id} value={a.id}>{a.label}</NativeSelectOption>)}
            </NativeSelect>
            {accounts.length === 0 && <p className="text-xs text-destructive">No active bank account – add one in Settings → Bank accounts and wallets</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** True when the form can be sent: cash adds up, or the reference, received-into account (and customer's bank) are filled in. */
export function payReady(v: PayValue, amount: number) {
  if (v.mode === "Cash") return amount > 0 && cashTotal(v) === amount;
  return !!v.reference.trim() && !!v.intoAccountId && (v.mode !== "NetBanking" || (!!v.bankName.trim() && !!v.netType));
}
