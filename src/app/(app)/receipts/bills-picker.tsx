"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { inr, paise } from "@/components/payment-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { DmyDateInput } from "@/components/dmy-date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PolicyOption } from "@/lib/receipt-options";
import { cn } from "@/lib/utils";
import { generateAdvanceBills } from "./group-actions";

const TAG_STYLE = { Overdue: "text-destructive", Due: "text-foreground", Advance: "text-brand-700" };

/** Overdue and due bills of each policy. */
export const unpaidCounts = (policies: PolicyOption[]): Record<string, number> =>
  Object.fromEntries(policies.map((p) => [p.id, p.dues.filter((d) => d.tag !== "Advance").length] as const).filter(([, n]) => n > 0));

/** Total (paise) and number of bills ticked. Ticks are oldest-first per policy: `counts[policyId]` = bills ticked. */
export function ticked(policies: PolicyOption[], counts: Record<string, number>) {
  const picked = policies.filter((p) => (counts[p.id] ?? 0) > 0);
  return {
    // `from` = the oldest bill the user saw: the server refuses if someone else has paid it meanwhile (D-01).
    dues: picked.map((p) => ({ policyId: p.id, count: counts[p.id], from: p.dues[0]?.date })),
    total: picked.reduce((t, p) => t + p.dues.slice(0, counts[p.id]).reduce((s, d) => s + paise(d.amount), 0), 0),
    count: picked.reduce((t, p) => t + counts[p.id], 0),
  };
}

/**
 * "Bills to pay": tick bills (ticking one ticks the older ones of that policy). With `scope` (a customer or a bill
 * group) it also offers instalments by date: From / To → "Show instalments" ticks every bill up to To (older unpaid
 * ones included, since bills are paid oldest first), "Generate late bill" (PDF of the overdue ones) and
 * "Generate advance bills" (raises the advance ones as Due bills, no payment).
 */
export function BillsPicker({ policies, counts, onChange, scope, showCustomer = false, search = false, showSettled = false }: {
  policies: PolicyOption[]; counts: Record<string, number>; onChange: (c: Record<string, number>) => void;
  scope?: { customerId: string } | { billGroupId: string }; showCustomer?: boolean; search?: boolean;
  /** Also list policies with nothing to pay (e.g. paid 12 months ahead) as grey lines, instead of leaving them out. */
  showSettled?: boolean;
}) {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [q, setQ] = useState("");
  const [raising, startRaise] = useTransition();
  const withDues = policies.filter((p) => p.dues.length);
  const settled = showSettled ? policies.filter((p) => !p.dues.length) : [];
  const unpaid = unpaidCounts(withDues);
  const allUnpaidTicked = Object.keys(unpaid).length > 0 && Object.entries(unpaid).every(([id, n]) => (counts[id] ?? 0) >= n);
  const needle = q.trim().toLowerCase();
  const shownPolicies = needle ? withDues.filter((p) => `${p.customer} ${p.label} ${p.dues.map((d) => d.billNo).join(" ")}`.toLowerCase().includes(needle)) : withDues;

  function showInstalments() {
    if (!to) return toast.error("Pick the To date");
    if (from && from > to) return toast.error("From must be on or before To");
    setRange({ from, to });
    onChange(Object.fromEntries(withDues.map((p) => [p.id, p.dues.filter((d) => d.date <= to).length] as const).filter(([, n]) => n > 0)));
  }

  const scopeParams = scope ? new URLSearchParams({ ...scope, from: range?.from ?? "", to: range?.to ?? "" }) : null;
  function raiseAdvance() {
    if (!scope || !range) return;
    const form = new FormData();
    Object.entries({ ...scope, to: range.to }).forEach(([k, v]) => form.set(k, v));
    startRaise(async () => {
      const r = await generateAdvanceBills({ ok: false }, form);
      if (!r.ok) return void toast.error(r.error ?? "Could not raise the bills");
      toast.success(r.message ?? "Done");
      router.refresh();
      window.open(`/api/instalment-bills?kind=advance&${scopeParams}`, "_blank");
    });
  }

  const inRange = (p: PolicyOption) => (range ? p.dues.filter((d) => d.date <= range.to) : null);
  const lateCount = range ? withDues.reduce((t, p) => t + p.dues.filter((d) => d.date <= range.to && d.tag === "Overdue").length, 0) : 0;
  const advanceCount = range ? withDues.reduce((t, p) => t + p.dues.filter((d) => d.date <= range.to && d.tag === "Advance" && !d.billNo).length, 0) : 0;
  const olderThanFrom = range?.from ? withDues.reduce((t, p) => t + p.dues.filter((d) => d.date < range.from).length, 0) : 0;
  const t = ticked(withDues, counts);

  return (
    <div className="space-y-2">
      <Label>Bills to pay</Label>
      {scope && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-2 text-sm">
          <div className="space-y-1"><Label htmlFor="bills-from" className="text-xs">From</Label><DmyDateInput id="bills-from" value={from} onChange={setFrom} className="h-8" /></div>
          <div className="space-y-1"><Label htmlFor="bills-to" className="text-xs">To</Label><DmyDateInput id="bills-to" value={to} onChange={setTo} className="h-8" /></div>
          <Button type="button" size="sm" variant="outline" onClick={showInstalments}>Show instalments</Button>
          {range && (
            <>
              <a href={`/api/instalment-bills?kind=late&${scopeParams}`} target="_blank" rel="noreferrer"
                className={cn(buttonVariants({ size: "sm", variant: "outline" }), !lateCount && "pointer-events-none opacity-50")} aria-disabled={!lateCount}>
                Generate late bill{lateCount ? ` (${lateCount})` : ""}
              </a>
              <Button type="button" size="sm" variant="outline" disabled={raising || !advanceCount} onClick={raiseAdvance}>
                {raising ? "Raising…" : `Generate advance bills${advanceCount ? ` (${advanceCount})` : ""}`}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRange(null)}>Show all</Button>
            </>
          )}
        </div>
      )}
      {search && <Input value={q} onChange={(e) => setQ(e.target.value)} className="h-8 max-w-md" aria-label="Find bills" />}
      {withDues.length === 0 && settled.length === 0 ? <p className="text-sm text-muted-foreground">No bills to pay.</p> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                {!search && <input type="checkbox" aria-label="Tick all due bills" checked={allUnpaidTicked} onChange={(e) => onChange(e.target.checked ? { ...counts, ...unpaid } : {})} />}
              </TableHead>
              {showCustomer && <TableHead>Customer</TableHead>}<TableHead>Policy / account</TableHead><TableHead>Due</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shownPolicies.flatMap((p) => {
              const n = counts[p.id] ?? 0;
              // In a date range: the bills up to To. Otherwise every unpaid bill, the advance bills ticked and one more to tick.
              const rows = inRange(p) ?? p.dues.slice(0, Math.max(p.dues.filter((d) => d.tag !== "Advance").length, Math.min(n + 1, p.dues.length)));
              return rows.map((d, i) => (
                <TableRow key={`${p.id}-${i}`} className={cn(i > 0 && "border-t-0", i < n && "bg-saffron-50/40")}>
                  <TableCell>
                    <input type="checkbox" aria-label={`Pay ${p.label} ${d.label}`} checked={i < n} onChange={(e) => onChange({ ...counts, [p.id]: e.target.checked ? i + 1 : i })} />
                  </TableCell>
                  {showCustomer && <TableCell>{i === 0 ? p.customer : ""}</TableCell>}
                  <TableCell className="whitespace-normal">{i === 0 ? p.label : ""}</TableCell>
                  <TableCell>{d.label}{range?.from && d.date < range.from && <span className="ml-1 text-xs text-muted-foreground">(before From)</span>}</TableCell>
                  <TableCell className={cn("text-xs", TAG_STYLE[d.tag])}>{d.tag}</TableCell>
                  <TableCell className="text-right">{inr(paise(d.amount))}</TableCell>
                </TableRow>
              ));
            })}
            {settled.map((p) => (
              <TableRow key={p.id} className="text-muted-foreground">
                <TableCell><input type="checkbox" disabled aria-label={`${p.label}: nothing to pay`} /></TableCell>
                {showCustomer && <TableCell>{p.customer}</TableCell>}
                <TableCell className="whitespace-normal">{p.label}</TableCell>
                <TableCell colSpan={3} className="text-xs">Nothing to pay{p.paidUntil ? ` · paid up to ${p.paidUntil}` : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">
        {search ? "Tick the bills being paid, across any customers. " : "Every overdue and due bill is ticked; untick what is not being paid. "}
        Bills are paid oldest first{scope ? "; advance up to 12 months ahead, never past the product's bill rule or maturity" : ""}.
        {olderThanFrom > 0 && ` ${olderThanFrom} unpaid bill(s) before From are included: older bills are paid first.`}
        {t.count > 1 && ` ${t.count} bills · ${inr(t.total)} → one receipt, with the split per bill.`}
      </p>
    </div>
  );
}
