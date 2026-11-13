"use client";

import type { Frequency, InvoiceRule, ProductType } from "@prisma/client";
import Link from "next/link";
import { useActionState, useState } from "react";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { useConfirmBeforeSave } from "@/components/confirm-save";
import { Button } from "@/components/ui/button";
import { DmyDateInput } from "@/components/dmy-date-input";
import { Input } from "@/components/ui/input";
import { isoToDmy } from "@/lib/dates";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AMOUNT_WORD, amountHeader, type AmountKind, MF_PAY_MODES, orderGroups, payModeLabel, quoteGroup } from "@/lib/products";
import { createQuotation } from "../actions";

// Product → company → plan all come from Settings → Products and schemes (owner change list #12, 13 Nov 2026).

type Item = { category: string; insurer: string; productName: string; sumInsured: string; premium: string; payMode: Frequency };
const blank = (category: string): Item => ({ category, insurer: "", productName: "", sumInsured: "", premium: "", payMode: "Yearly" });
type Plan = { partner: string; name: string; payModes: Frequency[]; productType: ProductType; invoiceRule: InvoiceRule; category: string | null };
const PAY_MODES: Frequency[] = ["Yearly", "HalfYearly", "Quarterly", "Monthly", "OneTime"];

// Display only — the server recomputes every amount. Paise as integers to avoid float drift.
const paise = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : 0);
const inr = (p: number) => (p / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: p % 100 ? 2 : 0 });

export function QuotationForm(props: { customerId: string; leadId: string; customerName: string; mobile: string; defaultValidUpto: string; plans: Plan[] }) {
  const { plans } = props;
  const groups = orderGroups(plans.map(quoteGroup));
  const [items, setItems] = useState<Item[]>([blank(groups[0] ?? ""), blank(groups[1] ?? groups[0] ?? "")]);
  const [state, action, pending] = useActionState<ActionResult, FormData>(createQuotation, { ok: false });
  const set = (n: number, patch: Partial<Item>) => setItems(items.map((it, i) => (i === n ? { ...it, ...patch } : it)));
  const inGroup = (it: Item) => plans.filter((p) => quoteGroup(p) === it.category);
  const planOf = (it: Item) => inGroup(it).find((p) => p.partner === it.insurer && p.name === it.productName);
  // A mutual fund row reads AMC / Scheme / SIP or Lumpsum / Investment amount and has no cover. The plan's type decides
  // (any category name); before a plan is picked, a category whose products are all mutual funds / post office schemes.
  const allOf = (it: Item, test: (p: Plan) => boolean) => (planOf(it) ? test(planOf(it)!) : inGroup(it).length > 0 && inGroup(it).every(test));
  const isMf = (it: Item) => allOf(it, (p) => p.productType === "MutualFund");
  // Post office schemes (not PLI): no sum insured and the amount may be left blank.
  const postOfficeInvestment = (it: Item) => allOf(it, (p) => p.productType.startsWith("Po"));
  const noCover = (it: Item) => isMf(it) || postOfficeInvestment(it);
  const modesOf = (it: Item) => planOf(it)?.payModes.length ? planOf(it)!.payModes : isMf(it) ? MF_PAY_MODES : PAY_MODES;
  /** Patch for a row that has just changed: the pay mode follows the plan, and a sum insured is dropped when there is no cover. */
  const changed = (it: Item, patch: Partial<Item>): Partial<Item> => {
    const next = { ...it, ...patch };
    const modes = modesOf(next);
    return { ...patch, ...(!modes.includes(next.payMode) && { payMode: modes[0] }), ...(noCover(next) && { sumInsured: "" }) };
  };
  const anyMf = items.some(isMf), allMf = items.every(isMf), allNoCover = items.every(noCover);
  // Money column: Premium (insurance, PLI), Investment amount (mutual fund), Amount (other post office schemes).
  const kind = (it: Item): AmountKind => (isMf(it) ? "investment" : postOfficeInvestment(it) ? "amount" : "premium");
  const head = (insurance: string, mf: string) => (allMf ? mf : anyMf ? `${insurance} / ${mf}` : insurance);
  const total = items.reduce((t, it) => t + paise(it.premium), 0);
  const confirm = useConfirmBeforeSave(action, (form) => [
    ["Customer", String(form.get("customerName") ?? "")],
    ["Mobile", String(form.get("mobile") ?? "")],
    ["Valid till", isoToDmy(String(form.get("validUpto") ?? ""))],
    ...items.filter((it) => it.insurer || it.productName || it.premium).map((it, n): [string, string] => [
      `Product ${n + 1}`, `${it.category} · ${[it.insurer, it.productName].filter(Boolean).join(" ")} · ${payModeLabel(it.payMode, isMf(it))}\n${paise(it.premium) ? inr(paise(it.premium)) : "no amount"}${it.sumInsured ? ` · cover ${inr(paise(it.sumInsured))}` : ""}`,
    ]),
    [allMf ? "Total investment" : "Total", total ? inr(total) : "—"],
  ]);

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border bg-white p-4 text-sm">
        No products to quote yet. Add them in <Link href="/settings/products" className="text-brand-700 underline">Settings → Products and schemes</Link> first.
      </div>
    );
  }

  return (
    <form onSubmit={confirm.onSubmit} className="space-y-4 rounded-xl border bg-white p-4">
      <input type="hidden" name="customerId" value={props.customerId} />
      <input type="hidden" name="leadId" value={props.leadId} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />

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
          <DmyDateInput name="validUpto" defaultValue={props.defaultValidUpto} />
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">Product</TableHead><TableHead>{head("Company", "AMC")}</TableHead><TableHead>{head("Plan", "Scheme")}</TableHead>
            {!allNoCover && <TableHead className="w-36">Sum insured / cover</TableHead>}<TableHead className="w-36">{head("Pay mode", "SIP / Lumpsum")}</TableHead><TableHead className="w-32">{amountHeader(items.map(kind))}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it, n) => {
            const mf = isMf(it);
            const companies = [...new Set(inGroup(it).map((p) => p.partner))];
            const names = inGroup(it).filter((p) => p.partner === it.insurer).map((p) => p.name);
            return (
              <TableRow key={n}>
                <TableCell>
                  <NativeSelect value={it.category} onChange={(e) => set(n, changed(it, { category: e.target.value, insurer: "", productName: "" }))} aria-label="Product" className="w-full">
                    {groups.map((g) => <NativeSelectOption key={g} value={g}>{g}</NativeSelectOption>)}
                  </NativeSelect>
                </TableCell>
                <TableCell>
                  <NativeSelect value={it.insurer} onChange={(e) => {
                    const only = inGroup(it).filter((p) => p.partner === e.target.value);
                    set(n, changed(it, { insurer: e.target.value, productName: only.length === 1 ? only[0].name : "" }));
                  }} aria-label={mf ? "AMC" : "Company"} className="w-full">
                    <NativeSelectOption value=""></NativeSelectOption>
                    {companies.map((c) => <NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>)}
                  </NativeSelect>
                </TableCell>
                <TableCell>
                  <NativeSelect value={it.productName} onChange={(e) => set(n, changed(it, { productName: e.target.value }))} aria-label={mf ? "Scheme" : "Plan"} className="w-full" disabled={!it.insurer}>
                    <NativeSelectOption value=""></NativeSelectOption>
                    {names.map((p) => <NativeSelectOption key={p} value={p}>{p}</NativeSelectOption>)}
                  </NativeSelect>
                </TableCell>
                {!allNoCover && <TableCell>{noCover(it) ? <span className="text-muted-foreground">—</span> : <Input value={it.sumInsured} onChange={(e) => set(n, { sumInsured: e.target.value })} aria-label="Sum insured" inputMode="decimal" />}</TableCell>}
                <TableCell>
                  <NativeSelect value={it.payMode} onChange={(e) => set(n, { payMode: e.target.value as Frequency })} aria-label={mf ? "SIP or Lumpsum" : "Pay mode"} className="w-full">
                    {modesOf(it).map((m) => <NativeSelectOption key={m} value={m}>{payModeLabel(m, mf)}</NativeSelectOption>)}
                  </NativeSelect>
                </TableCell>
                <TableCell><Input value={it.premium} onChange={(e) => set(n, { premium: e.target.value })} aria-label={AMOUNT_WORD[kind(it)]} inputMode="decimal" /></TableCell>
                <TableCell>
                  {items.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setItems(items.filter((_, i) => i !== n))}>Remove</Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow>
            <TableCell colSpan={allNoCover ? 4 : 5}>
              {items.length < 5 && <Button type="button" variant="outline" size="sm" onClick={() => setItems([...items, blank(groups[0])])}>Add product</Button>}
            </TableCell>
            <TableCell className="font-semibold">{allMf ? "Total investment" : "Total payable"} {total ? inr(total) : "—"}</TableCell>
            <TableCell />
          </TableRow>
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">Products, companies and plans come from Settings → Products and schemes; add a new plan there first.</p>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save quotation"}</Button>
      {confirm.dialog}
    </form>
  );
}
