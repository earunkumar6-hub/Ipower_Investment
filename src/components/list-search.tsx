"use client";

import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Search box + button for a list page. The term lives in the URL (?q=) like the other list filters. */
export function ListSearch({ q }: { q?: string }) {
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
        <Input id="q" name="q" defaultValue={q} className="w-72" />
      </div>
      <Button type="submit" variant="outline">Search</Button>
    </form>
  );
}
