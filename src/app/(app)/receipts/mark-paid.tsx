"use client";

import { useRouter } from "next/navigation";
import { createContext, useActionState, useContext, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { CashDenominationGrid } from "@/components/cash-denomination-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { submitKeepingValues } from "@/lib/form";
import { markReceiptsPaid } from "./mark-paid-actions";

/** A receipt that can be marked paid: amount in paise; `company` = insurer / AMC / post office; `rd` = goes as a PO deposit. */
export type PayableReceipt = { id: string; paise: number; company: string; rd: boolean };

type Ctx = { ticked: string[]; toggle: (id: string, on: boolean) => void; setAll: (on: boolean) => void; ids: string[] };
const Selection = createContext<Ctx | null>(null);

const inr = (p: number) => (p / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 });

/**
 * Customer receipts: tick receipts of any customers and companies, then "Mark paid" records paying them on (owner,
 * 4 Nov 2026): one company payment per company, RD receipts as one PO deposit – same date, account and reference.
 */
export function MarkPaidProvider({ receipts, accounts, today, children }: {
  receipts: PayableReceipt[]; accounts: { id: string; name: string; type: string }[]; today: string; children: React.ReactNode;
}) {
  const router = useRouter();
  const [ticked, setTicked] = useState<string[]>([]);
  const [accountId, setAccountId] = useState("");
  const [key, setKey] = useState(0);
  const ids = receipts.map((r) => r.id);
  const selected = receipts.filter((r) => ticked.includes(r.id));
  const total = selected.reduce((t, r) => t + r.paise, 0);
  const parts = [...selected.reduce((m, r) => m.set(r.rd ? "Post office RD deposit" : r.company, (m.get(r.rd ? "Post office RD deposit" : r.company) ?? 0) + r.paise), new Map<string, number>())];
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await markReceiptsPaid(prev, form);
    if (r.ok) {
      toast.success(r.message ?? "Marked paid; Day Book updated");
      setTicked([]);
      setKey((k) => k + 1);
      router.refresh();
    }
    return r;
  }, { ok: false });
  const ctx: Ctx = {
    ticked, ids,
    toggle: (id, on) => setTicked((t) => (on ? [...t, id] : t.filter((x) => x !== id))),
    setAll: (on) => setTicked(on ? ids : []),
  };

  return (
    <Selection.Provider value={ctx}>
      {children}
      {selected.length > 0 && (
        <form key={key} onSubmit={submitKeepingValues(action)} className="sticky bottom-2 mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-saffron-200 bg-saffron-50 p-3 shadow-md">
          <input type="hidden" name="receiptIds" value={ticked.join(",")} />
          <div className="text-sm">
            <div className="text-xs text-muted-foreground">Mark paid to the company</div>
            <div className="font-semibold">{selected.length} {selected.length === 1 ? "receipt" : "receipts"} · {inr(total)}</div>
            <div className="text-xs text-muted-foreground">{parts.map(([name, p]) => `${name} ${inr(p)}`).join(" · ")}</div>
          </div>
          <div className="space-y-1"><Label htmlFor="mp-paidOn" className="text-xs">Paid on</Label><Input id="mp-paidOn" name="paidOn" type="date" defaultValue={today} max={today} className="h-8" /></div>
          <div className="space-y-1">
            <Label htmlFor="mp-account" className="text-xs">Paid from</Label>
            <NativeSelect id="mp-account" name="accountId" size="sm" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <NativeSelectOption value=""></NativeSelectOption>
              {accounts.map((a) => <NativeSelectOption key={a.id} value={a.id}>{a.name}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="space-y-1"><Label htmlFor="mp-ref" className="text-xs">Company receipt / UTR / PO receipt no.</Label><Input id="mp-ref" name="reference" className="h-8 w-56" /></div>
          <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : `Mark ${selected.length} paid`}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setTicked([])}>Clear</Button>
          {accounts.find((a) => a.id === accountId)?.type === "Cash" && <div className="w-full"><CashDenominationGrid amount={total} idPrefix="mp" /></div>}
          {state.error && <p className="w-full text-xs text-destructive">{state.error}</p>}
        </form>
      )}
    </Selection.Provider>
  );
}

/** Tick box on a receipt row (only rendered for receipts still waiting to be paid on). */
export function MarkPaidBox({ id, label }: { id: string; label: string }) {
  const s = useContext(Selection)!;
  return <input type="checkbox" aria-label={label} checked={s.ticked.includes(id)} onChange={(e) => s.toggle(id, e.target.checked)} className="size-4 accent-brand-600" />;
}

/** Header tick box: every waiting receipt on this page. */
export function MarkPaidAll() {
  const s = useContext(Selection)!;
  if (!s.ids.length) return null;
  const all = s.ticked.length === s.ids.length;
  return <input type="checkbox" aria-label="Tick every receipt waiting to be paid" checked={all} onChange={(e) => s.setAll(e.target.checked)} className="size-4 accent-brand-600" />;
}
