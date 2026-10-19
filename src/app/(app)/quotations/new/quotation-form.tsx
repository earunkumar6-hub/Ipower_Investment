"use client";

import type { Frequency } from "@prisma/client";
import { useActionState, useState } from "react";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { useConfirmBeforeSave } from "@/components/confirm-save";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PAY_MODE_LABEL } from "@/lib/products";
import { createQuotation } from "../actions";

const CATEGORIES = ["Health", "Life", "Motor", "Personal accident", "Other"];
const INSURERS = ["Star Health", "Care Health", "SBI Life", "LIC", "HDFC Life", "ICICI Lombard", "Niva Bupa"];

type Item = { category: string; insurer: string; productName: string; sumInsured: string; premium: string; payMode: Frequency };
const blank = (category: string): Item => ({ category, insurer: "", productName: "", sumInsured: "", premium: "", payMode: "Yearly" });
type Plan = { partner: string; name: string; payModes: Frequency[] };
const PAY_MODES: Frequency[] = ["Yearly", "HalfYearly", "Quarterly", "Monthly", "OneTime"];

// Display only — the server recomputes every amount. Paise as integers to avoid float drift.
const paise = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : 0);
const gstPaise = (p: number) => Math.round((p * 18) / 100);
const inr = (p: number) => (p / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: p % 100 ? 2 : 0 });

export function QuotationForm(props: { customerId: string; leadId: string; customerName: string; mobile: string; defaultValidUpto: string; plans: Plan[] }) {
  const [items, setItems] = useState<Item[]>([blank("Health"), blank("Life")]);
  const [state, action, pending] = useActionState<ActionResult, FormData>(createQuotation, { ok: false });
  const set = (n: number, patch: Partial<Item>) => setItems(items.map((it, i) => (i === n ? { ...it, ...patch } : it)));
  const totals = items.reduce(
    (t, it) => {
      const p = paise(it.premium), g = gstPaise(p);
      return { premium: t.premium + p, gst: t.gst + g, total: t.total + p + g };
    },
    { premium: 0, gst: 0, total: 0 },
  );
  const fmtValid = (iso: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
  const confirm = useConfirmBeforeSave(action, (form) => [
    ["Customer", String(form.get("customerName") ?? "")],
    ["Mobile", String(form.get("mobile") ?? "")],
    ["Valid till", fmtValid(String(form.get("validUpto") ?? ""))],
    ...items.filter((it) => it.insurer || it.productName || it.premium).map((it, n): [string, string] => [
      `Product ${n + 1}`, `${it.category} · ${[it.insurer, it.productName].filter(Boolean).join(" ")} · ${PAY_MODE_LABEL[it.payMode]}\n${inr(paise(it.premium))} + GST ${inr(gstPaise(paise(it.premium)))}${it.sumInsured ? ` · cover ${inr(paise(it.sumInsured))}` : ""}`,
    ]),
    ["Total", inr(totals.total)],
  ]);

  return (
    <form onSubmit={confirm.onSubmit} className="space-y-4 rounded-xl border bg-white p-4">
      <input type="hidden" name="customerId" value={props.customerId} />
      <input type="hidden" name="leadId" value={props.leadId} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <datalist id="insurers">{[...new Set([...props.plans.map((p) => p.partner), ...INSURERS])].map((i) => <option key={i} value={i} />)}</datalist>

      <div className="grid max-w-3xl grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="customerName">Customer</Label>
          <Input id="customerName" name="customerName" defaultValue={props.customerName} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mobile">Mobile</Label>
          <Input id="mobile" name="mobile" defaultValue={props.mobile} inputMode="numeric" maxLength={10} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="validUpto">Valid till</Label>
          <Input id="validUpto" name="validUpto" type="date" defaultValue={props.defaultValidUpto} />
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">Product</TableHead><TableHead>Insurer</TableHead><TableHead>Plan</TableHead>
            <TableHead className="w-36">Sum insured / cover</TableHead><TableHead className="w-32">Pay mode</TableHead><TableHead className="w-32">Premium</TableHead>
            <TableHead className="text-right">GST 18%</TableHead><TableHead className="text-right">Total</TableHead><TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it, n) => {
            const p = paise(it.premium), g = gstPaise(p);
            return (
              <TableRow key={n}>
                <TableCell>
                  <NativeSelect value={it.category} onChange={(e) => set(n, { category: e.target.value })} aria-label="Product" className="w-full">
                    {CATEGORIES.map((c) => <NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>)}
                  </NativeSelect>
                </TableCell>
                <TableCell><Input list="insurers" value={it.insurer} onChange={(e) => set(n, { insurer: e.target.value })} aria-label="Insurer" placeholder="Star Health" /></TableCell>
                <TableCell>
                  <Input list={`plans-${n}`} value={it.productName} onChange={(e) => {
                    const plan = props.plans.find((p) => p.partner === it.insurer && p.name === e.target.value);
                    set(n, { productName: e.target.value, ...(plan && !plan.payModes.includes(it.payMode) && { payMode: plan.payModes[0] }) });
                  }} aria-label="Plan" placeholder="Family Health Optima" />
                  <datalist id={`plans-${n}`}>{props.plans.filter((p) => !it.insurer || p.partner === it.insurer).map((p) => <option key={`${p.partner}-${p.name}`} value={p.name} />)}</datalist>
                </TableCell>
                <TableCell><Input value={it.sumInsured} onChange={(e) => set(n, { sumInsured: e.target.value })} aria-label="Sum insured" inputMode="decimal" placeholder="1000000" /></TableCell>
                <TableCell>
                  <NativeSelect value={it.payMode} onChange={(e) => set(n, { payMode: e.target.value as Frequency })} aria-label="Pay mode" className="w-full">
                    {PAY_MODES.map((m) => <NativeSelectOption key={m} value={m}>{PAY_MODE_LABEL[m]}</NativeSelectOption>)}
                  </NativeSelect>
                </TableCell>
                <TableCell><Input value={it.premium} onChange={(e) => set(n, { premium: e.target.value })} aria-label="Premium" inputMode="decimal" placeholder="18983" /></TableCell>
                <TableCell className="text-right">{inr(g)}</TableCell>
                <TableCell className="text-right font-medium">{inr(p + g)}</TableCell>
                <TableCell>
                  {items.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setItems(items.filter((_, i) => i !== n))}>Remove</Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow>
            <TableCell colSpan={5}>
              {items.length < 5 && <Button type="button" variant="outline" size="sm" onClick={() => setItems([...items, blank("Health")])}>Add product</Button>}
            </TableCell>
            <TableCell className="font-medium">{inr(totals.premium)}</TableCell>
            <TableCell className="text-right font-medium">{inr(totals.gst)}</TableCell>
            <TableCell className="text-right font-semibold">{inr(totals.total)}</TableCell>
            <TableCell />
          </TableRow>
        </TableBody>
      </Table>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save quotation"}</Button>
      {confirm.dialog}
    </form>
  );
}
