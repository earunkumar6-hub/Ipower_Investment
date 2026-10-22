"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NOTES } from "@/lib/payment-modes";
import { cn } from "@/lib/utils";

// Cash denomination (₹500, ₹200, ₹100, ₹50, ₹20, ₹10, coins): Count × Note = Amount; the total must equal the cash amount.
// The server checks it again (checkDenominations in src/lib/payment-options.ts).

export type Cash = { notes: Record<string, string>; coins: string };
export const emptyCash = (): Cash => ({ notes: {}, coins: "" });

export const paise = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v.trim()) ? Math.round(Number(v) * 100) : 0);
export const inr = (p: number) => (p / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: p % 100 ? 2 : 0 });
const count = (v: string | undefined) => (/^\d+$/.test(v ?? "") ? Number(v) : 0);
export const cashTotal = (c: Cash) => NOTES.reduce((t, n) => t + n * 100 * count(c.notes[n]), paise(c.coins));

/** JSON the server expects: { "500": 4, "200": 2, coins: "12.50" }. */
export const cashJson = (c: Cash) =>
  JSON.stringify({ ...Object.fromEntries(NOTES.filter((n) => count(c.notes[n])).map((n) => [`${n}`, count(c.notes[n])])), coins: c.coins });

/** The grid itself (controlled). `amount` in paise. */
export function DenominationInputs({ value, onChange, amount, error, idPrefix = "note" }: {
  value: Cash; onChange: (c: Cash) => void; amount: number; error?: string; idPrefix?: string;
}) {
  const total = cashTotal(value);
  const off = amount > 0 && total !== amount;
  return (
    <div className="space-y-1.5">
      <Label>Cash denomination</Label>
      {/* Each box at least ~4.5rem wide (3–4 digits visible); narrow panels wrap to a second row. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2 rounded-lg border p-2">
        {NOTES.map((n) => (
          <div key={n} className="space-y-1">
            <Label htmlFor={`${idPrefix}-${n}`} className="text-xs text-muted-foreground">₹{n} ×</Label>
            <Input id={`${idPrefix}-${n}`} inputMode="numeric" value={value.notes[n] ?? ""} placeholder="0" aria-invalid={!!error} className="min-w-0 text-right"
              onChange={(e) => onChange({ ...value, notes: { ...value.notes, [n]: e.target.value.replace(/\D/g, "") } })} />
          </div>
        ))}
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-coins`} className="text-xs text-muted-foreground">Coins ₹</Label>
          <Input id={`${idPrefix}-coins`} inputMode="decimal" value={value.coins} placeholder="0" className="min-w-0 text-right" onChange={(e) => onChange({ ...value, coins: e.target.value })} />
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Total</span>
          <div className={cn("flex h-8 items-center text-sm font-semibold", off ? "text-destructive" : "text-green-700")}>{inr(total)}</div>
        </div>
      </div>
      {off && <p className="text-xs text-destructive">Notes and coins must add up to {inr(amount)} ({total > amount ? `${inr(total - amount)} too much` : `${inr(amount - total)} short`}).</p>}
      {error && !off && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Grid for plain forms: keeps its own state and sends the JSON in a hidden `denominations` field. */
export function CashDenominationGrid({ amount, error, name = "denominations", idPrefix }: { amount: number; error?: string; name?: string; idPrefix?: string }) {
  const [cash, setCash] = useState<Cash>(emptyCash());
  return (
    <>
      <input type="hidden" name={name} value={cashJson(cash)} />
      <DenominationInputs value={cash} onChange={setCash} amount={amount} error={error} idPrefix={idPrefix} />
    </>
  );
}
