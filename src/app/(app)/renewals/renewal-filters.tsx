"use client";

import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DmyDateInput } from "@/components/dmy-date-input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type Pairs = readonly (readonly [string, string])[];
type Props = {
  tab: string; product: string; company?: string; scheme?: string; paidTo: string;
  range: { pick: string; from: string; to: string } | null; showRange: boolean;
  products: Pairs; paidToOptions: Pairs; rangePicks: Pairs; companies: string[]; schemes: [string, string][];
};

/** Product → company → scheme, and the date range (quick pick or From / To). A broader pick clears the narrower ones; the tab is kept. */
export function RenewalFilters({ tab, product, company, scheme, paidTo, range, showRange, products, paidToOptions, rangePicks, companies, schemes }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const custom = range?.pick === "custom";

  function go(next: { product?: string; company?: string; scheme?: string; paidto?: string; range?: string; from?: string; to?: string }) {
    const base = { product, company, scheme, paidto: paidTo, ...(range && (custom ? { from: range.from, to: range.to } : range.pick !== "within" ? { range: range.pick } : {})) };
    const merged: Record<string, string | undefined> = { ...base, ...next };
    if ("product" in next) { merged.company = next.company; merged.scheme = next.scheme; }
    if ("range" in next) { merged.from = undefined; merged.to = undefined; }
    if ("from" in next) merged.range = undefined;
    const params = new URLSearchParams({ tab });
    for (const [k, v] of Object.entries(merged)) if (v && v !== "all") params.set(k, v);
    router.push(`${pathname}?${params}`);
  }

  const byCompany = product === "insurance" || product === "mf";
  return (
    <div className="flex flex-wrap items-end gap-3 pb-2">
      <div className="space-y-1">
        <Label htmlFor="product" className="text-xs">Product</Label>
        <NativeSelect id="product" size="sm" value={product} onChange={(e) => go({ product: e.target.value })}>
          {products.map(([k, l]) => <NativeSelectOption key={k} value={k}>{l}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      {byCompany && (
        <div className="space-y-1">
          <Label htmlFor="company" className="text-xs">{product === "mf" ? "AMC" : "Insurance company"}</Label>
          <NativeSelect id="company" size="sm" value={company ?? ""} onChange={(e) => go({ product, company: e.target.value })}>
            <NativeSelectOption value="">All</NativeSelectOption>
            {companies.map((c) => <NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>)}
          </NativeSelect>
        </div>
      )}
      {schemes.length > 0 && (
        <div className="space-y-1">
          <Label htmlFor="scheme" className="text-xs">Scheme</Label>
          <NativeSelect id="scheme" size="sm" value={scheme ?? ""} onChange={(e) => go({ product, company, scheme: e.target.value })}>
            <NativeSelectOption value="">All</NativeSelectOption>
            {schemes.map(([v, l]) => <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}
          </NativeSelect>
        </div>
      )}
      {showRange && (
        <>
          <div className="space-y-1">
            <Label htmlFor="range" className="text-xs">View</Label>
            <NativeSelect id="range" size="sm" value={custom ? "custom" : range?.pick && rangePicks.some(([k]) => k === range.pick) ? range.pick : ""} onChange={(e) => {
              // "Custom dates" (spec #19): the From / To boxes set the range – go to From instead of reloading.
              if (e.target.value === "custom") return document.querySelector<HTMLInputElement>('input[aria-label="From date"], #from')?.focus();
              go({ range: e.target.value || undefined });
            }}>
              <NativeSelectOption value="">{tab === "overdue" ? "Any date" : "Default"}</NativeSelectOption>
              {rangePicks.map(([k, l]) => <NativeSelectOption key={k} value={k}>{l}</NativeSelectOption>)}
              <NativeSelectOption value="custom">Custom dates</NativeSelectOption>
              {custom && <NativeSelectOption value="custom">Custom dates</NativeSelectOption>}
            </NativeSelect>
          </div>
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); go({ from: String(fd.get("from") ?? ""), to: String(fd.get("to") ?? "") }); }}>
            <div className="space-y-1"><Label htmlFor="from" className="text-xs">From date</Label><DmyDateInput name="from" defaultValue={range?.from ?? ""} className="h-7 w-36" /></div>
            <div className="space-y-1"><Label htmlFor="to" className="text-xs">To date</Label><DmyDateInput name="to" defaultValue={range?.to ?? ""} className="h-7 w-36" /></div>
            <Button type="submit" size="sm" variant="outline">Show renewals</Button>
          </form>
        </>
      )}
      {tab === "paid" && (
        <div className="space-y-1">
          <Label htmlFor="paidto" className="text-xs">Paid to Post office / Insurer</Label>
          <NativeSelect id="paidto" size="sm" value={paidTo} onChange={(e) => go({ paidto: e.target.value })}>
            {paidToOptions.map(([k, l]) => <NativeSelectOption key={k} value={k}>{l}</NativeSelectOption>)}
          </NativeSelect>
        </div>
      )}
    </div>
  );
}
