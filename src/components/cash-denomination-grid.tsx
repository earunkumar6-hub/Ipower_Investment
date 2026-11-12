"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NOTES } from "@/lib/payment-modes";
import { cn } from "@/lib/utils";

// Cash denomination (₹500, ₹200, ₹100, ₹50, ₹20, ₹10, coins): Count × Note = Amount. Two parts (owner change list,
// #47): notes received and, optionally, change given back – received − change must equal the cash amount, and only
// that amount counts in the Day Book. The server checks it again (checkDenominations in src/lib/payment-options.ts).

type Notes = { notes: Record<string, string>; coins: string };
export type Cash = Notes & { change?: Notes };
export const emptyCash = (): Cash => ({ notes: {}, coins: "" });

export const paise = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v.trim()) ? Math.round(Number(v) * 100) : 0);
export const inr = (p: number) => (p / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: p % 100 ? 2 : 0 });
const count = (v: string | undefined) => (/^\d+$/.test(v ?? "") ? Number(v) : 0);
const notesTotal = (c: Notes) => NOTES.reduce((t, n) => t + n * 100 * count(c.notes[n]), paise(c.coins));
const changeTotal = (c: Cash) => (c.change ? notesTotal(c.change) : 0);
/** Cash kept, in paise: notes received minus change given back. */
export const cashTotal = (c: Cash) => notesTotal(c) - changeTotal(c);

const notesJson = (c: Notes) => ({ ...Object.fromEntries(NOTES.filter((n) => count(c.notes[n])).map((n) => [`${n}`, count(c.notes[n])])), coins: c.coins });
/** JSON the server expects: { "500": 4, "200": 2, coins: "12.50", change: { "50": 1, coins: "" } } (change only when given). */
export const cashJson = (c: Cash) =>
  JSON.stringify({ ...notesJson(c), ...(changeTotal(c) > 0 && { change: notesJson(c.change!) }) });

/** One row of note / coin boxes with its total. */
function NoteBoxes({ value, onChange, idPrefix, error, totalTone }: {
  value: Notes; onChange: (n: Notes) => void; idPrefix: string; error?: boolean; totalTone: string;
}) {
  return (
    // Each box at least ~4.5rem wide (3–4 digits visible); narrow panels wrap to a second row.
    <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2 rounded-lg border p-2">
      {NOTES.map((n) => (
        <div key={n} className="space-y-1">
          <Label htmlFor={`${idPrefix}-${n}`} className="text-xs text-muted-foreground">₹{n} ×</Label>
          <Input id={`${idPrefix}-${n}`} inputMode="numeric" value={value.notes[n] ?? ""} aria-invalid={error} className="min-w-0 text-right"
            onChange={(e) => onChange({ ...value, notes: { ...value.notes, [n]: e.target.value.replace(/\D/g, "") } })} />
        </div>
      ))}
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-coins`} className="text-xs text-muted-foreground">Coins ₹</Label>
        <Input id={`${idPrefix}-coins`} inputMode="decimal" value={value.coins} className="min-w-0 text-right" onChange={(e) => onChange({ ...value, coins: e.target.value })} />
      </div>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Total</span>
        <div className={cn("flex h-8 items-center text-sm font-semibold", totalTone)}>{inr(notesTotal(value))}</div>
      </div>
    </div>
  );
}

/**
 * The grid itself (controlled). `amount` in paise. Notes received, and "+ Change given back" for the notes handed back
 * (#47): received − change must equal the amount. Example: charge ₹20, customer gives ₹100 → change ₹50 + ₹20 + ₹10.
 */
export function DenominationInputs({ value, onChange, amount, error, idPrefix = "note" }: {
  value: Cash; onChange: (c: Cash) => void; amount: number; error?: string; idPrefix?: string;
}) {
  const total = cashTotal(value);
  const off = amount > 0 && total !== amount;
  const withChange = !!value.change;
  return (
    <div className="space-y-1.5">
      <Label>{withChange ? "Cash received" : "Cash denomination"}</Label>
      <NoteBoxes value={value} onChange={(n) => onChange({ ...value, ...n })} idPrefix={idPrefix} error={!!error}
        totalTone={withChange ? "text-foreground" : off ? "text-destructive" : "text-green-700"} />
      {withChange ? (
        <>
          <div className="flex items-center justify-between">
            <Label>Change given back</Label>
            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => onChange({ ...value, change: undefined })}>No change</button>
          </div>
          <NoteBoxes value={value.change!} onChange={(n) => onChange({ ...value, change: n })} idPrefix={`${idPrefix}-chg`} error={!!error} totalTone="text-foreground" />
          <p className={cn("text-xs font-medium", off ? "text-destructive" : "text-green-700")}>
            Received {inr(notesTotal(value))} − change {inr(changeTotal(value))} = cash kept {inr(total)}
          </p>
        </>
      ) : (
        <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => onChange({ ...value, change: { notes: {}, coins: "" } })}>+ Change given back</button>
      )}
      {off && <p className="text-xs text-destructive">{withChange ? "Received minus change" : "Notes and coins"} must come to {inr(amount)} ({total > amount ? `${inr(total - amount)} too much` : `${inr(amount - total)} short`}).</p>}
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
