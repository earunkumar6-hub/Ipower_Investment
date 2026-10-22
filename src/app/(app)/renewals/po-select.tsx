"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendRemindersBulk } from "./actions";

// Renewals → Due / Overdue with Post office schemes: tick customers' rows (or all), then send the reminder to every
// ticked row or take one combined receipt for the ticked bills.

/** `bill` = a renewal item (can be paid); `maturity` = a one-time scheme's maturity row (reminder only). */
export type TickItem = { key: string; kind: "bill" | "maturity"; id: string };

const Ctx = createContext<{ ticked: Set<string>; toggle: (k: string, on: boolean) => void; all: TickItem[]; setAll: (on: boolean) => void } | null>(null);
const useTicks = () => useContext(Ctx)!;

export function PoSelection({ items, canReceipt, children }: { items: TickItem[]; canReceipt: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const toggle = (k: string, on: boolean) => setTicked((t) => { const n = new Set(t); if (on) n.add(k); else n.delete(k); return n; });
  const setAll = (on: boolean) => setTicked(on ? new Set(items.map((i) => i.key)) : new Set());
  const chosen = items.filter((i) => ticked.has(i.key));
  const bills = chosen.filter((i) => i.kind === "bill");

  function remind() {
    start(async () => {
      const r = await sendRemindersBulk(bills.map((b) => b.id), chosen.filter((i) => i.kind === "maturity").map((m) => m.id));
      if (r.ok) toast.success(r.message ?? "Reminders sent");
      else toast.error(r.error ?? "Could not send");
      setTicked(new Set());
    });
  }

  return (
    <Ctx.Provider value={{ ticked, toggle, all: items, setAll }}>
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2 text-sm">
        <span className="text-muted-foreground">{chosen.length ? `${chosen.length} ticked` : "Tick customers to act on several at once"}</span>
        <Button type="button" size="sm" variant="outline" disabled={pending || !chosen.length} onClick={remind}>
          {pending ? "Sending…" : `Send reminder to ticked${chosen.length ? ` (${chosen.length})` : ""}`}
        </Button>
        {canReceipt && (
          <Button type="button" size="sm" className="bg-brand-600 hover:bg-brand-700" disabled={!bills.length}
            onClick={() => router.push(`/receipts/combined/new?bills=${bills.map((b) => b.id).join(",")}`)}>
            One combined receipt{bills.length ? ` (${bills.length} bills)` : ""}
          </Button>
        )}
        {chosen.length > bills.length && <span className="text-xs text-muted-foreground">Maturity rows get the reminder only; they have no bill to pay.</span>}
      </div>
      {children}
    </Ctx.Provider>
  );
}

export function PoCheckAll() {
  const { ticked, all, setAll } = useTicks();
  return <input type="checkbox" aria-label="Tick all customers" checked={all.length > 0 && ticked.size === all.length} onChange={(e) => setAll(e.target.checked)} />;
}

export function PoCheck({ k, label }: { k: string; label: string }) {
  const { ticked, toggle } = useTicks();
  return <input type="checkbox" aria-label={`Tick ${label}`} checked={ticked.has(k)} onChange={(e) => toggle(k, e.target.checked)} />;
}
