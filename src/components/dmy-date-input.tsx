"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { dmyToIso, isoToDmy } from "@/lib/dates";

type Props = {
  name?: string; defaultValue?: string; error?: string;
  /** Controlled use: the date as yyyy-mm-dd ("" while it isn't a real date). */
  value?: string; onChange?: (iso: string) => void;
  /** Earliest / latest date allowed, yyyy-mm-dd. */
  min?: string; max?: string;
} & Omit<React.ComponentProps<"input">, "name" | "defaultValue" | "value" | "onChange" | "type" | "min" | "max">;

/**
 * Date box that always reads dd/mm/yyyy (a browser date box follows the computer's language, often mm/dd/yyyy).
 * Slashes are added while typing; the calendar button opens the browser's date picker. The form posts `name` as
 * yyyy-mm-dd; a date that isn't real or is outside `min` / `max` stops the form like a browser date box does.
 */
export function DmyDateInput({ name, defaultValue = "", error, value, onChange, min, max, disabled, ...props }: Props) {
  const [text, setText] = useState(isoToDmy(value ?? defaultValue));
  const [seen, setSeen] = useState(value);
  if (value !== seen) { // the form changed the date itself (reset, prefill)
    setSeen(value);
    if (value !== undefined && value !== dmyToIso(text)) setText(isoToDmy(value));
  }
  const box = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const iso = dmyToIso(text);
  const problem = text && !iso ? "Not a real date – use dd/mm/yyyy"
    : iso && min && iso < min ? `Not before ${isoToDmy(min)}`
    : iso && max && iso > max ? `Not after ${isoToDmy(max)}` : "";
  useEffect(() => box.current?.setCustomValidity(problem), [problem]);
  const set = (next: string) => { setText(next); onChange?.(dmyToIso(next)); };
  return (
    <>
      <div className="relative flex items-center gap-1">
        <Input id={name} {...props} ref={box} disabled={disabled} value={text} inputMode="numeric" maxLength={10} autoComplete="off"
          aria-invalid={!!error || !!props["aria-invalid"] || (!!problem && (!!iso || text.length === 10))}
          onChange={(e) => {
            if (isoToDmy(e.target.value)) return set(isoToDmy(e.target.value)); // a pasted yyyy-mm-dd
            const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
            set([digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join("/"));
          }} />
        <button type="button" tabIndex={-1} aria-label="Open calendar" disabled={disabled} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-slate-100 hover:text-foreground disabled:opacity-50"
          onClick={() => picker.current?.showPicker()}>
          <CalendarDays className="size-4" />
        </button>
        {/* Only there for its calendar: never posted, and kept valid so it can't block the form. */}
        <input ref={picker} type="date" tabIndex={-1} aria-hidden min={min} max={max} value={problem ? "" : iso} className="pointer-events-none absolute right-0 bottom-0 h-px w-px opacity-0"
          onChange={(e) => set(isoToDmy(e.target.value))} />
      </div>
      {name && <input type="hidden" name={name} value={iso || text} />}
      {problem && !error && (iso || text.length === 10) && <p className="text-xs text-destructive">{problem}</p>}
    </>
  );
}
