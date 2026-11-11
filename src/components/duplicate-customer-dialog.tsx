"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Duplicate } from "@/lib/identity";
import { cn } from "@/lib/utils";

/**
 * #28: an Aadhaar, PAN or company CIF already belongs to someone else. Shows who, and offers only
 * "Open existing customer" or "Go back and correct" – a second customer can't be saved.
 */
export function DuplicateCustomerDialog({ duplicate, onClose }: { duplicate: Duplicate | null | undefined; onClose: () => void }) {
  const d = duplicate;
  return (
    <Dialog open={!!d} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {d && (
          <>
            <span className="w-fit rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Already exists</span>
            <DialogTitle className="text-lg font-semibold">{d.matchedOn.join(" and ")} already {d.matchedOn.length > 1 ? "belong" : "belongs"} to {d.name}</DialogTitle>
            <DialogDescription>The same {d.matchedOn.length > 1 ? "numbers" : "number"} can&apos;t be saved for a second person. Open the existing record, or go back and correct it.</DialogDescription>
            <dl className="divide-y rounded-lg border text-sm">
              {[
                ["Name", `${d.name}${!d.customerId && d.proposalId ? " – not a customer yet (on a proposal)" : ""}`],
                ["Mobile", d.mobile || "—"],
                ["Matched on", d.matchedOn.join(" + ")],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-3 gap-2 px-3 py-2"><dt className="text-muted-foreground">{k}</dt><dd className="col-span-2">{v}</dd></div>
              ))}
              <div className="grid grid-cols-3 gap-2 px-3 py-2">
                <dt className="text-muted-foreground">Products held</dt>
                <dd className="col-span-2">{d.products.length ? <ul className="space-y-0.5">{d.products.map((p) => <li key={p}>{p}</li>)}</ul> : "None yet"}</dd>
              </div>
            </dl>
            <div className="flex gap-2">
              {d.customerId ? (
                <Link href={`/customers/${d.customerId}`} className={cn(buttonVariants(), "bg-brand-600 hover:bg-brand-700")}>Open existing customer</Link>
              ) : d.proposalId ? (
                <Link href={`/proposals/${d.proposalId}`} className={cn(buttonVariants(), "bg-brand-600 hover:bg-brand-700")}>Open the proposal</Link>
              ) : null}
              <Button type="button" variant="outline" onClick={onClose}>Go back and correct</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
