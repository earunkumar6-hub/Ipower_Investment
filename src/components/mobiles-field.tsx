"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MobileEntry } from "@/lib/mobiles";

/** Mobile numbers with "+ Add number" and a "Same as WhatsApp" tick on each (leads and customers). */
export function MobilesField({ initial, error }: { initial: MobileEntry[]; error?: string }) {
  const [rows, setRows] = useState(() => initial.map((m, i) => ({ ...m, key: i })));
  const [next, setNext] = useState(initial.length);
  return (
    <div className="space-y-1.5">
      <Label>Mobile number<span className="text-destructive"> *</span></Label>
      {rows.map((m, i) => (
        <div key={m.key} className="flex items-center gap-2">
          <Input name="mobile" defaultValue={m.number} inputMode="numeric" maxLength={10}
            aria-label={`Mobile number ${i + 1}`} aria-invalid={!!error} className="flex-1" />
          <label className="flex shrink-0 items-center gap-1.5 text-xs">
            <input type="checkbox" name="whatsApp" value={i} defaultChecked={m.isWhatsApp} className="size-4 accent-brand-600" /> Same as WhatsApp
          </label>
          {rows.length > 1 && (
            <Button type="button" size="icon-xs" variant="ghost" aria-label="Remove number" onClick={() => setRows(rows.filter((r) => r.key !== m.key))}><XIcon /></Button>
          )}
        </div>
      ))}
      {rows.length < 4 && (
        <Button type="button" size="xs" variant="ghost" onClick={() => { setRows([...rows, { number: "", isWhatsApp: false, key: next }]); setNext(next + 1); }}>
          <PlusIcon /> Add number
        </Button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
