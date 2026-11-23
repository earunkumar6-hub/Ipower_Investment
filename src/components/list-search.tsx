"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LiveSearchInput } from "@/components/live-search-input";
import { Label } from "@/components/ui/label";

/** Search box + button for a list page. The term lives in the URL (?q=) like the other list filters. */
export function ListSearch({ q }: { q?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const current = useSearchParams();

  // Keeps the other filters in the address (tab, issued…) and starts again from the first page.
  function search(v: string, replace = false) {
    const params = new URLSearchParams(current);
    params.delete("page");
    if (v) params.set("q", v); else params.delete("q");
    const url = params.size ? `${pathname}?${params}` : pathname;
    if (replace) router.replace(url); else router.push(url);
  }

  return (
    <form
      className="mb-4 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const v = String(new FormData(e.currentTarget).get("q") ?? "").trim();
        search(v);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="q">Search</Label>
        <LiveSearchInput id="q" name="q" defaultValue={q} className="w-72" onSearch={(v) => search(v, true)} />
      </div>
      <Button type="submit" variant="outline">Search</Button>
    </form>
  );
}
