"use client";

import { usePathname, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Search lives in the URL (?q=) like the other list filters. */
export function ProposalSearch({ q }: { q?: string }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <form
      className="mb-4 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const v = String(new FormData(e.currentTarget).get("q") ?? "").trim();
        router.push(v ? `${pathname}?q=${encodeURIComponent(v)}` : pathname);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="q">Search</Label>
        <Input id="q" name="q" defaultValue={q} placeholder="Mobile, first holder name or proposal no." className="w-72" />
      </div>
    </form>
  );
}
