"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { dmyToIso, isoToDmy } from "@/lib/dates";

/**
 * Date box that always reads dd/mm/yyyy (a browser date box follows the computer's language, often mm/dd/yyyy).
 * Slashes are added while typing; the form posts `name` as yyyy-mm-dd, or the typed text when it isn't a real
 * date so the server's check reports it.
 */
export function DmyDateInput({ name, defaultValue = "", error, ...props }: { name: string; defaultValue?: string; error?: string } & Omit<React.ComponentProps<"input">, "name" | "defaultValue" | "value" | "onChange" | "type">) {
  const [text, setText] = useState(isoToDmy(defaultValue));
  const iso = dmyToIso(text);
  const bad = text.length === 10 && !iso;
  return (
    <>
      <Input id={name} {...props} value={text} inputMode="numeric" maxLength={10} placeholder="dd/mm/yyyy" autoComplete="off" aria-invalid={!!error || bad}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
          setText([digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join("/"));
        }} />
      <input type="hidden" name={name} value={iso || text} />
      {bad && !error && <p className="text-xs text-destructive">Not a real date – use dd/mm/yyyy</p>}
    </>
  );
}
