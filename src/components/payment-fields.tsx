"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cashJson, cashTotal, DenominationInputs, inr, paise } from "@/components/cash-denomination-grid";
import { MODE_LABEL, NET_TYPES, REFERENCE_LABEL, type ReceiptMode } from "@/lib/payment-modes";
import { cn } from "@/lib/utils";

export type PayValue = { mode: ReceiptMode; reference: string; bankName: string; netType: string; notes: Record<string, string>; coins: string; intoAccountId: string };
/** A bank account for the "Received into" picker. */
export type IntoAccount = { id: string; label: string };
/** `accounts[0]` (the default bank) is picked to start with. */
export const emptyPay = (modes: ReceiptMode[], accounts: IntoAccount[] = []): PayValue =>
  ({ mode: modes[0] ?? "Cash", reference: "", bankName: "", netType: "", notes: {}, coins: "", intoAccountId: accounts[0]?.id ?? "" });

export { cashTotal, inr, paise };

/** Form fields sent to the server: mode, reference, bankName + netType (net banking), the denomination as JSON (cash only), received into (not cash). */
export function payFormFields(v: PayValue): Record<string, string> {
  const cash = v.mode === "Cash";
  return {
    mode: v.mode, reference: cash ? "" : v.reference, bankName: v.mode === "NetBanking" ? v.bankName : "", netType: v.mode === "NetBanking" ? v.netType : "",
    denominations: cash ? cashJson(v) : "", intoAccountId: cash ? "" : v.intoAccountId,
  };
}

/**
 * Mode buttons, then what the mode needs: cash denomination, or UTR / transaction ID / cheque no., the customer's bank
 * and the company bank account it was received into (`accounts`: active bank accounts, default first).
 */
export function PaymentFields({ modes, banks, accounts, amount, value, onChange, errors = {} }: {
  modes: ReceiptMode[]; banks: string[]; accounts: IntoAccount[]; amount: number; value: PayValue; onChange: (v: PayValue) => void; errors?: Record<string, string>;
}) {
  const set = (patch: Partial<PayValue>) => onChange({ ...value, ...patch });
  return (
    <div className="col-span-2 space-y-3">
      <div className="space-y-1.5">
        <Label>Payment mode</Label>
        <div className="flex flex-wrap gap-2">
          {modes.map((m) => (
            <button key={m} type="button" onClick={() => set({ mode: m })}
              className={cn("h-8 min-w-24 flex-1 rounded-lg border px-2 text-sm", value.mode === m ? "border-brand-600 bg-saffron-50 font-medium text-brand-700" : "hover:bg-slate-50")}>
              {MODE_LABEL[m]}
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
              <NativeSelect id="bankName" value={value.bankName} className="w-full" aria-invalid={!!errors.bankName} onChange={(e) => set({ bankName: e.target.value })}>
                <NativeSelectOption value=""></NativeSelectOption>
                {banks.map((b) => <NativeSelectOption key={b} value={b}>{b}</NativeSelectOption>)}
              </NativeSelect>
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
  return !!v.reference.trim() && !!v.intoAccountId && (v.mode !== "NetBanking" || (!!v.bankName && !!v.netType));
}
