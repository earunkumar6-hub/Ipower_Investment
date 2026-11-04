"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CashDenominationGrid } from "@/components/cash-denomination-grid";
import { submitKeepingValues } from "@/lib/form";
import { payToCompany } from "./actions";

export type PaidRow = {
  id: string; customerId: string; customer: string; product: string; policyNumber: string; due: string; amount: string; paise: number;
  paidOn: string; receiptId: string | null; receiptNo: string | null; receiptHref: string | null; collectedBy: string | null; company: string;
  status: { state: "pending" | "paid"; text: string; payable: boolean };
};

const inr = (p: number) => (p / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 });

/** Paid tab: tick receipts still pending for one company, then record paying that company in one go. */
export function PaidTable({ rows, accounts, today, canPay }: { rows: PaidRow[]; accounts: { id: string; name: string; type: string }[]; today: string; canPay: boolean }) {
  const [ticked, setTicked] = useState<string[]>([]);
  const [accountId, setAccountId] = useState("");
  const [key, setKey] = useState(0);
  const selected = rows.filter((r) => r.receiptId && ticked.includes(r.receiptId));
  const company = selected[0]?.company;
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await payToCompany(prev, form);
    if (r.ok) {
      toast.success(`Payment to ${company} saved; Day Book updated`);
      setTicked([]);
      setKey((k) => k + 1);
    } else toast.error(r.error);
    return r;
  }, { ok: false });
  const total = selected.reduce((t, r) => t + r.paise, 0);
  const toggle = (id: string, on: boolean) => setTicked(on ? [...ticked, id] : ticked.filter((x) => x !== id));

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {canPay && <TableHead className="w-8" />}
            <TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Policy / account</TableHead><TableHead>Due</TableHead>
            <TableHead className="text-right">Amount</TableHead><TableHead>Paid · receipt</TableHead><TableHead>Collected by</TableHead><TableHead>Paid to Post office / Insurer</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const tickable = canPay && r.status.payable && !!r.receiptId;
            return (
              <TableRow key={r.id}>
                {canPay && (
                  <TableCell>
                    {tickable && (
                      <input type="checkbox" aria-label={`Pay ${r.receiptNo} to ${r.company}`} checked={ticked.includes(r.receiptId!)}
                        disabled={!!company && company !== r.company} title={company && company !== r.company ? `Only ${company} receipts can go with this payment` : undefined}
                        onChange={(e) => toggle(r.receiptId!, e.target.checked)} />
                    )}
                  </TableCell>
                )}
                <TableCell><Link href={`/customers/${r.customerId}`} className="text-brand-700 hover:underline">{r.customer}</Link></TableCell>
                <TableCell>{r.product}</TableCell>
                <TableCell>{r.policyNumber}</TableCell>
                <TableCell>{r.due}</TableCell>
                <TableCell className="text-right">{r.amount}</TableCell>
                <TableCell className="text-sm">
                  {r.paidOn} · {r.receiptHref ? <Link href={r.receiptHref} className="text-brand-700 hover:underline">{r.receiptNo}</Link> : "owner paid"}
                </TableCell>
                <TableCell className="text-sm">{r.collectedBy ?? "—"}</TableCell>
                <TableCell className="text-sm">
                  {r.status.state === "paid" ? <span className="text-green-700">{r.status.text}</span> : <StatusBadge tone="orange">{r.status.text}</StatusBadge>}
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && <TableRow><TableCell colSpan={canPay ? 9 : 8} className="py-6 text-center text-muted-foreground">Nothing here.</TableCell></TableRow>}
        </TableBody>
      </Table>
      {canPay && selected.length > 0 && (
        <form key={key} onSubmit={submitKeepingValues(action)} className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-saffron-200 bg-saffron-50 p-3">
          <input type="hidden" name="receiptIds" value={ticked.join(",")} />
          <div className="text-sm">
            <div className="text-xs text-muted-foreground">Pay to {company}</div>
            <div className="font-semibold">{selected.length} {selected.length === 1 ? "receipt" : "receipts"} · {inr(total)}</div>
          </div>
          <div className="space-y-1"><Label htmlFor="paidOn" className="text-xs">Paid on</Label><Input id="paidOn" name="paidOn" type="date" defaultValue={today} max={today} className="h-8" /></div>
          <div className="space-y-1">
            <Label htmlFor="accountId" className="text-xs">Paid from</Label>
            <NativeSelect id="accountId" name="accountId" size="sm" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <NativeSelectOption value=""></NativeSelectOption>
              {accounts.map((a) => <NativeSelectOption key={a.id} value={a.id}>{a.name}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="space-y-1"><Label htmlFor="reference" className="text-xs">Company receipt / UTR no.</Label><Input id="reference" name="reference" className="h-8 w-48" /></div>
          <Button type="submit" size="sm" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : `Save payment to ${company}`}</Button>
          {accounts.find((a) => a.id === accountId)?.type === "Cash" && <div className="w-full"><CashDenominationGrid amount={total} idPrefix="pay" /></div>}
          {state.error && <p className="w-full text-xs text-destructive">{state.error}</p>}
        </form>
      )}
    </>
  );
}
