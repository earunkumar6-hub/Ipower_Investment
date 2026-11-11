"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

// The "Other" rule: choosing Other shows a required text box. The server (resolveDropdown in src/lib/dropdowns.ts)
// refuses an empty value, saves the typed text with the entry and adds it to the list for next time.

export const OTHER = "Other";

type Common = { options: string[]; placeholder?: string; error?: string; size?: "sm" | "default"; label?: string; id?: string; className?: string };

/** Controlled: for forms that keep their values in state (e.g. quotation product rows). */
export function OtherSelect({ value, other, onChange, options, placeholder, error, size, label, id, className }: Common & {
  value: string; other: string; onChange: (value: string, other: string) => void;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <NativeSelect id={id} value={value} size={size} aria-label={label} aria-invalid={!!error && value !== OTHER} className="w-full"
        onChange={(e) => onChange(e.target.value, e.target.value === OTHER ? other : "")}>
        {placeholder !== undefined && <NativeSelectOption value="">{placeholder}</NativeSelectOption>}
        {options.map((o) => <NativeSelectOption key={o} value={o}>{o}</NativeSelectOption>)}
        <NativeSelectOption value={OTHER}>{OTHER}</NativeSelectOption>
      </NativeSelect>
      {value === OTHER && (
        <Input value={other} required aria-label={`${label ?? "Value"} – other`} aria-invalid={!!error}
          className={size === "sm" ? "h-7" : undefined} onChange={(e) => onChange(OTHER, e.target.value)} />
      )}
    </div>
  );
}

/** For plain forms: sends `name` and `${name}Other`. */
export function OtherOptionSelect({ name, defaultValue = "", ...rest }: Common & { name: string; defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  const [other, setOther] = useState("");
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <input type="hidden" name={`${name}Other`} value={other} />
      <OtherSelect value={value} other={other} onChange={(v, o) => { setValue(v); setOther(o); }} {...rest} />
    </>
  );
}
