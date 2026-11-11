"use client";

import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type Pairs = readonly (readonly [string, string])[];
type Props = {
  q: string; product: string; company?: string; scheme?: string; status: string;
  products: Pairs; statuses: Pairs; companies: string[]; schemes: [string, string][];
};

/** Search plus holdings filter: product → company → scheme, and status. A broader pick clears the narrower ones. */
export function CustomerFilters({ q, product, company, scheme, status, products, statuses, companies, schemes }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  function go(next: { q?: string; product?: string; company?: string; scheme?: string; status?: string }) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, status, ...next })) if (v && v !== "all") params.set(k, v);
    router.push(params.size ? `${pathname}?${params}` : pathname);
  }

  const byCompany = product === "insurance" || product === "mf";
  const filtered = product !== "all" || status !== "all";
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); go({ q: String(new FormData(e.currentTarget).get("q") ?? ""), product, company, scheme }); }}>
        <div className="space-y-1">
          <Label htmlFor="q" className="text-xs">Search</Label>
          <Input id="q" name="q" defaultValue={q} placeholder="Name, mobile, policy / account or folio no." className="h-7 w-64" />
        </div>
        <Button type="submit" size="sm" variant="outline" className="self-end">Search</Button>
      </form>
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
      <div className="space-y-1">
        <Label htmlFor="status" className="text-xs">Holding status</Label>
        <NativeSelect id="status" size="sm" value={status} onChange={(e) => go({ product, company, scheme, status: e.target.value })}>
          {statuses.map(([k, l]) => <NativeSelectOption key={k} value={k}>{l}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      {(filtered || q) && <Button type="button" size="sm" variant="ghost" onClick={() => router.push(pathname)}>Clear</Button>}
    </div>
  );
}
