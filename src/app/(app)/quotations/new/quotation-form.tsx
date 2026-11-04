"use client";

import type { Frequency, ProductType } from "@prisma/client";
import { useActionState, useState } from "react";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { useConfirmBeforeSave } from "@/components/confirm-save";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { OTHER, OtherSelect } from "@/components/other-option-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isMfCategory, MF_PAY_MODES, payModeLabel } from "@/lib/products";
import { createQuotation } from "../actions";

const INSURERS = ["Star Health", "Care Health", "SBI Life", "LIC", "HDFC Life", "ICICI Lombard", "Niva Bupa"];

type Item = { category: string; categoryOther: string; insurer: string; productName: string; sumInsured: string; premium: string; payMode: Frequency };
const blank = (category: string): Item => ({ category, categoryOther: "", insurer: "", productName: "", sumInsured: "", premium: "", payMode: "Yearly" });
type Plan = { partner: string; name: string; payModes: Frequency[]; productType: ProductType };
const PAY_MODES: Frequency[] = ["Yearly", "HalfYearly", "Quarterly", "Monthly", "OneTime"];

// Display only — the server recomputes every amount. Paise as integers to avoid float drift.
const paise = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : 0);
const inr = (p: number) => (p / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: p % 100 ? 2 : 0 });

export function QuotationForm(props: { customerId: string; leadId: string; customerName: string; mobile: string; defaultValidUpto: string; plans: Plan[]; categories: string[] }) {
  const { categories } = props;
  const [items, setItems] = useState<Item[]>([blank(categories[0] ?? OTHER), blank(categories[1] ?? categories[0] ?? OTHER)]);
  const [state, action, pending] = useActionState<ActionResult, FormData>(createQuotation, { ok: false });
  const set = (n: number, patch: Partial<Item>) => setItems(items.map((it, i) => (i === n ? { ...it, ...patch } : it)));
  // A "Mutual fund" row reads AMC / Scheme / SIP or Lumpsum / Investment amount and has no cover.
  const isMf = (it: Item) => isMfCategory(it.category === OTHER ? it.categoryOther : it.category);
  const setCategory = (n: number, category: string, categoryOther: string) => {
    const it = items[n], mf = isMfCategory(category === OTHER ? categoryOther : category);
    const payMode = mf ? (MF_PAY_MODES.includes(it.payMode) ? it.payMode : "Monthly") : isMf(it) ? "Yearly" : it.payMode;
    set(n, { category, categoryOther, payMode, ...(mf && { sumInsured: "" }) });
  };
  const anyMf = items.some(isMf), allMf = items.every(isMf);
  const head = (insurance: string, mf: string) => (allMf ? mf : anyMf ? `${insurance} / ${mf}` : insurance);
  const total = items.reduce((t, it) => t + paise(it.premium), 0);
  const fmtValid = (iso: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
  const confirm = useConfirmBeforeSave(action, (form) => [
    ["Customer", String(form.get("customerName") ?? "")],
    ["Mobile", String(form.get("mobile") ?? "")],
    ["Valid till", fmtValid(String(form.get("validUpto") ?? ""))],
    ...items.filter((it) => it.insurer || it.productName || it.premium).map((it, n): [string, string] => [
      `Product ${n + 1}`, `${it.category === OTHER ? it.categoryOther : it.category} · ${[it.insurer, it.productName].filter(Boolean).join(" ")} · ${payModeLabel(it.payMode, isMf(it))}\n${inr(paise(it.premium))}${it.sumInsured ? ` · cover ${inr(paise(it.sumInsured))}` : ""}`,
    ]),
    [allMf ? "Total investment" : "Total", inr(total)],
  ]);

  return (
    <form onSubmit={confirm.onSubmit} className="space-y-4 rounded-xl border bg-white p-4">
      <input type="hidden" name="customerId" value={props.customerId} />
      <input type="hidden" name="leadId" value={props.leadId} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <datalist id="insurers">{[...new Set([...props.plans.filter((p) => p.productType !== "MutualFund").map((p) => p.partner), ...INSURERS])].map((i) => <option key={i} value={i} />)}</datalist>
      <datalist id="amcs">{[...new Set(props.plans.filter((p) => p.productType === "MutualFund").map((p) => p.partner))].map((i) => <option key={i} value={i} />)}</datalist>

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
            <TableHead className="w-40">Product</TableHead><TableHead>{head("Insurer", "AMC")}</TableHead><TableHead>{head("Plan", "Scheme")}</TableHead>
            {!allMf && <TableHead className="w-36">Sum insured / cover</TableHead>}<TableHead className="w-36">{head("Pay mode", "SIP / Lumpsum")}</TableHead><TableHead className="w-32">{head("Premium", "Investment amount")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it, n) => {
            const mf = isMf(it);
            return (
              <TableRow key={n}>
                <TableCell>
                  <OtherSelect value={it.category} other={it.categoryOther} options={categories} label="Product"
                    onChange={(category, categoryOther) => setCategory(n, category, categoryOther)} />
                </TableCell>
                <TableCell><Input list={mf ? "amcs" : "insurers"} value={it.insurer} onChange={(e) => set(n, { insurer: e.target.value })} aria-label={mf ? "AMC" : "Insurer"} placeholder={mf ? "HDFC MF" : "Star Health"} /></TableCell>
                <TableCell>
                  <Input list={`plans-${n}`} value={it.productName} onChange={(e) => {
                    const plan = props.plans.find((p) => p.partner === it.insurer && p.name === e.target.value);
                    set(n, { productName: e.target.value, ...(plan && !plan.payModes.includes(it.payMode) && { payMode: plan.payModes[0] }) });
                  }} aria-label={mf ? "Scheme" : "Plan"} placeholder={mf ? "Flexi Cap SIP" : "Family Health Optima"} />
                  <datalist id={`plans-${n}`}>{props.plans.filter((p) => (p.productType === "MutualFund") === mf && (!it.insurer || p.partner === it.insurer)).map((p) => <option key={`${p.partner}-${p.name}`} value={p.name} />)}</datalist>
                </TableCell>
                {!allMf && <TableCell>{mf ? <span className="text-muted-foreground">—</span> : <Input value={it.sumInsured} onChange={(e) => set(n, { sumInsured: e.target.value })} aria-label="Sum insured" inputMode="decimal" placeholder="1000000" />}</TableCell>}
                <TableCell>
                  <NativeSelect value={it.payMode} onChange={(e) => set(n, { payMode: e.target.value as Frequency })} aria-label={mf ? "SIP or Lumpsum" : "Pay mode"} className="w-full">
                    {(mf ? MF_PAY_MODES : PAY_MODES).map((m) => <NativeSelectOption key={m} value={m}>{payModeLabel(m, mf)}</NativeSelectOption>)}
                  </NativeSelect>
                </TableCell>
                <TableCell><Input value={it.premium} onChange={(e) => set(n, { premium: e.target.value })} aria-label={mf ? "Investment amount" : "Premium"} inputMode="decimal" placeholder={mf ? "5000" : "18983"} /></TableCell>
                <TableCell>
                  {items.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setItems(items.filter((_, i) => i !== n))}>Remove</Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow>
            <TableCell colSpan={allMf ? 4 : 5}>
              {items.length < 5 && <Button type="button" variant="outline" size="sm" onClick={() => setItems([...items, blank(categories[0] ?? OTHER)])}>Add product</Button>}
            </TableCell>
            <TableCell className="font-semibold">{allMf ? "Total investment" : "Total payable"} {inr(total)}</TableCell>
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
