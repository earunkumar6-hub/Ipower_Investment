"use client";

import { usePathname, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { LEAD_SOURCE_LABEL, LEAD_STATUS_LABEL } from "@/lib/lead-labels";

/** Filters live in the URL so dashboard cards can link straight to a filtered list. */
export function LeadFilters({ status, source, q }: { status?: string; source?: string; q?: string }) {
  const router = useRouter();
  const pathname = usePathname();

  function apply(form: HTMLFormElement) {
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(form)) if (v) params.set(k, String(v));
    router.push(`${pathname}?${params}`);
  }

  return (
    <form className="mb-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); apply(e.currentTarget); }}>
      <div className="space-y-1.5">
        <Label htmlFor="q">Search</Label>
        <Input id="q" name="q" defaultValue={q} placeholder="Name, mobile or lead no." className="w-56" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="status">Status</Label>
        <NativeSelect id="status" name="status" defaultValue={status ?? ""} onChange={(e) => apply(e.currentTarget.form!)}>
          <NativeSelectOption value="">All</NativeSelectOption>
          {Object.entries(LEAD_STATUS_LABEL).map(([v, l]) => <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="source">Source</Label>
        <NativeSelect id="source" name="source" defaultValue={source ?? ""} onChange={(e) => apply(e.currentTarget.form!)}>
          <NativeSelectOption value="">All</NativeSelectOption>
          {Object.entries(LEAD_SOURCE_LABEL).map(([v, l]) => <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}
        </NativeSelect>
      </div>
    </form>
  );
}
