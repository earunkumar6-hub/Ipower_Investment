"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { reminderHistory, type ReminderLine } from "./actions";

/**
 * Reminders sent (#24): count, last date and channel; click to see every reminder (date, channel, who sent it, the
 * message). `kind` "bill" = a renewal item, "maturity" = a policy's maturity reminders.
 */
export function ReminderHistory({ kind, id, count, last, channel, title }: {
  kind: "bill" | "maturity"; id: string; count: number; last: string | null; channel: string | null; title: string;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<ReminderLine[] | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  if (!count) return <span className="text-muted-foreground">—</span>;
  const show = () => {
    setOpen(true);
    start(async () => {
      const r = await reminderHistory(kind, id);
      if (r.ok) setLines(r.lines ?? []);
      else setError(r.error ?? "Could not load");
    });
  };
  return (
    <>
      <button type="button" onClick={show} className="text-left text-brand-700 hover:underline" title="See every reminder sent">
        {count}{last && <span className="block text-xs text-muted-foreground">last {last}{channel ? ` · ${channel}` : ""}</span>}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogTitle className="text-lg font-semibold">Reminders sent · {title}</DialogTitle>
          {pending && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {lines && (
            <ul className="max-h-96 divide-y overflow-y-auto text-sm">
              {lines.map((l, i) => (
                <li key={i} className="space-y-0.5 py-2">
                  <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground"><span>{l.at}</span><span>{l.channel}</span><span>by {l.by}</span><span>{l.status}</span></div>
                  <p className="whitespace-pre-wrap">{l.text}</p>
                </li>
              ))}
              {lines.length < count && (
                <li className="py-2 text-xs text-muted-foreground">
                  {count - lines.length} earlier reminder(s) were counted before messages were kept, so their details aren&apos;t available.
                </li>
              )}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
