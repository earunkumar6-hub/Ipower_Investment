"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { MODE_LABEL, NET_TYPES, NOTES, REFERENCE_LABEL, type ReceiptMode } from "@/lib/payment-modes";
import { cn } from "@/lib/utils";

export type PayValue = { mode: ReceiptMode; reference: string; bankName: string; netType: string; notes: Record<string, string>; coins: string };
export const emptyPay = (modes: ReceiptMode[]): PayValue => ({ mode: modes[0] ?? "Cash", reference: "", bankName: "", netType: "", notes: {}, coins: "" });

export const paise = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : 0);
export const inr = (p: number) => (p / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: p % 100 ? 2 : 0 });
const count = (v: string | undefined) => (/^\d+$/.test(v ?? "") ? Number(v) : 0);
export const cashTotal = (v: PayValue) => NOTES.reduce((t, n) => t + n * 100 * count(v.notes[n]), paise(v.coins));

/** Form fields sent to the server: mode, reference, bankName + netType (net banking) and the denomination as JSON (cash only). */
export function payFormFields(v: PayValue): Record<string, string> {
  const denominations = v.mode === "Cash"
    ? JSON.stringify({ ...Object.fromEntries(NOTES.filter((n) => count(v.notes[n])).map((n) => [`${n}`, count(v.notes[n])])), coins: v.coins })
    : "";
  return { mode: v.mode, reference: v.mode === "Cash" ? "" : v.reference, bankName: v.mode === "NetBanking" ? v.bankName : "", netType: v.mode === "NetBanking" ? v.netType : "", denominations };
}

/** Mode buttons, then what the mode needs: cash denomination, UTR / transaction ID / cheque no., the customer's bank. */
export function PaymentFields({ modes, banks, amount, value, onChange, errors = {} }: {
  modes: ReceiptMode[]; banks: string[]; amount: number; value: PayValue; onChange: (v: PayValue) => void; errors?: Record<string, string>;
}) {
  const set = (patch: Partial<PayValue>) => onChange({ ...value, ...patch });
  const total = cashTotal(value);
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
        <div className="space-y-1.5">
          <Label>Cash denomination</Label>
          <div className="grid grid-cols-4 gap-2 rounded-lg border p-2 sm:grid-cols-8">
            {NOTES.map((n) => (
              <div key={n} className="space-y-1">
                <Label htmlFor={`note-${n}`} className="text-xs text-muted-foreground">₹{n} ×</Label>
                <Input id={`note-${n}`} inputMode="numeric" value={value.notes[n] ?? ""} placeholder="0" aria-invalid={!!errors.denominations}
                  onChange={(e) => set({ notes: { ...value.notes, [n]: e.target.value.replace(/\D/g, "") } })} />
              </div>
            ))}
            <div className="space-y-1">
              <Label htmlFor="coins" className="text-xs text-muted-foreground">Coins ₹</Label>
              <Input id="coins" inputMode="decimal" value={value.coins} placeholder="0" onChange={(e) => set({ coins: e.target.value })} />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">Total</span>
              <div className={cn("flex h-8 items-center text-sm font-semibold", amount > 0 && total !== amount ? "text-destructive" : "text-green-700")}>{inr(total)}</div>
            </div>
          </div>
          {amount > 0 && total !== amount && (
            <p className="text-xs text-destructive">Notes and coins must add up to {inr(amount)} ({total > amount ? `${inr(total - amount)} too much` : `${inr(amount - total)} short`}).</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {value.mode === "NetBanking" && (
            <div className="space-y-1.5">
              <Label htmlFor="netType">Transfer type</Label>
              <NativeSelect id="netType" value={value.netType} className="w-full" aria-invalid={!!errors.netType} onChange={(e) => set({ netType: e.target.value })}>
                <NativeSelectOption value="">Pick…</NativeSelectOption>
                {NET_TYPES.map((t) => <NativeSelectOption key={t} value={t}>{t}</NativeSelectOption>)}
              </NativeSelect>
            </div>
          )}
          {value.mode === "NetBanking" && (
            <div className="space-y-1.5">
              <Label htmlFor="bankName">Customer&apos;s bank</Label>
              <NativeSelect id="bankName" value={value.bankName} className="w-full" aria-invalid={!!errors.bankName} onChange={(e) => set({ bankName: e.target.value })}>
                <NativeSelectOption value="">Pick the bank</NativeSelectOption>
                {banks.map((b) => <NativeSelectOption key={b} value={b}>{b}</NativeSelectOption>)}
              </NativeSelect>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="reference">{REFERENCE_LABEL[value.mode]}</Label>
            <Input id="reference" value={value.reference} onChange={(e) => set({ reference: e.target.value })} aria-invalid={!!errors.reference} />
          </div>
        </div>
      )}
    </div>
  );
}

/** True when the form can be sent: cash adds up, or the reference (and bank) is filled in. */
export function payReady(v: PayValue, amount: number) {
  if (v.mode === "Cash") return amount > 0 && cashTotal(v) === amount;
  return !!v.reference.trim() && (v.mode !== "NetBanking" || (!!v.bankName && !!v.netType));
}
