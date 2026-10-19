"use client";

import { usePathname, useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type Props = {
  tab: string; within?: string; product: string; company?: string; scheme?: string; paidTo: string;
  products: readonly (readonly [string, string])[]; paidToOptions: readonly (readonly [string, string])[];
  companies: string[]; schemes: [string, string][];
};

/** Product → company → scheme. Picking a broader filter clears the narrower ones; the tab is kept. */
export function RenewalFilters({ tab, within, product, company, scheme, paidTo, products, paidToOptions, companies, schemes }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  function go(next: { product: string; company?: string; scheme?: string }, paidto = paidTo) {
    const params = new URLSearchParams({ tab });
    if (within) params.set("within", within);
    for (const [k, v] of Object.entries(next)) if (v && !(k === "product" && v === "all")) params.set(k, v);
    if (paidto !== "all") params.set("paidto", paidto);
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
      {tab === "paid" && (
        <div className="space-y-1">
          <Label htmlFor="paidto" className="text-xs">Paid to Post office / Insurer</Label>
          <NativeSelect id="paidto" size="sm" value={paidTo} onChange={(e) => go({ product, company, scheme }, e.target.value)}>
            {paidToOptions.map(([k, l]) => <NativeSelectOption key={k} value={k}>{l}</NativeSelectOption>)}
          </NativeSelect>
        </div>
      )}
    </div>
  );
}
