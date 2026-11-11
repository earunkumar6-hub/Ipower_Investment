"use client";

import { PhoneIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { saveCallOutcome, type ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DmyDateInput } from "@/components/dmy-date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OpenCall } from "@/lib/leads";
import { submitKeepingValues } from "@/lib/form";
import { cn } from "@/lib/utils";

export const OPEN_CALL_REMINDER = "open-call-reminder";

/** Lead calls end with Interested / Not interested / call back; renewal and proposal calls with Done or call back. */
const OUTCOMES = {
  lead: [["Interested", "Interested"], ["NotInterested", "Not interested"], ["NoAnswer", "No answer / call back"]],
  renewal: [["Done", "Done"], ["NoAnswer", "No answer / call back"]],
  proposal: [["Done", "Done"], ["NoAnswer", "No answer / call back"]],
  customer: [["Done", "Done"], ["NoAnswer", "No answer / call back"]],
} as const;

/** Opens the reminder; with a call id it shows that call. */
export const openCallReminder = (callId?: string) => window.dispatchEvent(new CustomEvent(OPEN_CALL_REMINDER, { detail: { callId } }));

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });

function dueLabel(iso: string, now: number) {
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "due now";
  if (mins < 60) return `overdue ${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `overdue ${h} h ${mins % 60} min` : `overdue ${Math.floor(h / 24)} days`;
}

/** Tomorrow in IST, as yyyy-mm-dd. */
const tomorrowIst = () => new Date(Date.now() + 5.5 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);

/**
 * Shows on every screen. When one of the user's own calls is due it opens by itself
 * and cannot be dismissed until an outcome is saved. The header badge opens it on demand.
 */
export function CallReminder({ calls }: { calls: OpenCall[] }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [manualOpen, setManualOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const callsRef = useRef(calls);
  useEffect(() => { callsRef.current = calls; }, [calls]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    const refresh = setInterval(() => router.refresh(), 60_000); // pick up calls added by others
    const open = (e: Event) => {
      const id = (e as CustomEvent<{ callId?: string }>).detail?.callId;
      const at = id ? callsRef.current.findIndex((c) => c.id === id) : -1;
      if (at >= 0) setIndex(at);
      setManualOpen(true);
    };
    window.addEventListener(OPEN_CALL_REMINDER, open);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
      window.removeEventListener(OPEN_CALL_REMINDER, open);
    };
  }, [router]);

  const dueMine = calls.filter((c) => c.mine && new Date(c.dueAt).getTime() <= now);
  const forced = dueMine.length > 0;
  const list = forced ? dueMine : calls;
  const open = forced || (manualOpen && list.length > 0);
  const call = list[Math.min(index, list.length - 1)];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !forced && setManualOpen(false)}>
      <DialogContent showCloseButton={!forced} className="sm:max-w-md">
        {call && (
          <>
            <div className="flex items-center justify-between text-xs">
              {new Date(call.dueAt).getTime() <= now ? (
                <span className="rounded-full bg-orange-100 px-2 py-0.5 font-medium text-orange-800">Call reminder · {dueLabel(call.dueAt, now)}</span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">Scheduled · {fmtTime(call.dueAt)}</span>
              )}
              <span className={cn("text-muted-foreground", !forced && "mr-8")}>
                {list.length > 1 && (
                  <button type="button" className="mr-2 underline" onClick={() => setIndex((index + 1) % list.length)}>Next</button>
                )}
                {Math.min(index, list.length - 1) + 1} of {list.length} open
              </span>
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold">{call.name}</DialogTitle>
              <DialogDescription className="text-xs">
                {call.mobile} · {call.forLabel} · Owner: {call.ownerName} · Due {fmtTime(call.dueAt)}
              </DialogDescription>
              {call.note && <p className="mt-1 text-xs">Last note: {call.note}</p>}
            </div>
            <a href={`tel:${call.mobile}`} className="flex h-9 items-center justify-center gap-2 rounded-lg bg-brand-600 text-sm font-medium text-white hover:bg-brand-700">
              <PhoneIcon className="size-4" /> Call now
            </a>
            <OutcomeForm key={call.id} call={call} onSaved={() => { setIndex(0); if (!forced) setManualOpen(false); }} />
            {!forced && (call.leadId ? (
              <Link href={`/quotations/new?leadId=${call.leadId}`} onClick={() => setManualOpen(false)} className="text-sm text-brand-700 hover:underline">
                Create quotation for {call.name}
              </Link>
            ) : (
              <Link href={call.href} onClick={() => setManualOpen(false)} className="text-sm text-brand-700 hover:underline">Open {call.forLabel}</Link>
            ))}
            {forced && (
              <p className="text-xs text-muted-foreground">
                This reminder cannot be closed. It stays open on every screen until you save an outcome: No answer needs a new call time; Not interested needs a reason and closes the lead.
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OutcomeForm({ call, onSaved }: { call: OpenCall; onSaved: () => void }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const result = await saveCallOutcome(prev, form);
    if (result.ok) {
      toast.success(`Saved call for ${call.name}`);
      onSaved();
    }
    return result;
  }, { ok: false });
  const [outcome, setOutcome] = useState<string>("");
  const needsTime = outcome === "NoAnswer";

  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={submitKeepingValues(action)} className="space-y-3">
      <input type="hidden" name="callId" value={call.id} />
      <div className="space-y-1.5">
        <Label htmlFor="note">Notes</Label>
        <Textarea id="note" name="note" rows={2} />
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Outcome</legend>
        <div className="flex gap-2">
          {OUTCOMES[call.kind].map(([value, label]) => (
            <label key={value} className={cn("flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-2 py-2 text-sm",
              outcome === value && "border-brand-600 ring-1 ring-brand-600")}>
              <input type="radio" name="outcome" value={value} checked={outcome === value} onChange={() => setOutcome(value)} />
              {label}
            </label>
          ))}
        </div>
        {err.outcome && <p className="text-xs text-destructive">{err.outcome}</p>}
      </fieldset>
      {outcome === "Done" ? (
        <>
          <input type="hidden" name="reason" value="" />
          <input type="hidden" name="callDate" value="" />
          <input type="hidden" name="callTime" value="" />
        </>
      ) : outcome === "NotInterested" ? (
        <div className="space-y-1.5">
          <Label htmlFor="reason">Reason</Label>
          <Input id="reason" name="reason" aria-invalid={!!err.reason} />
          <input type="hidden" name="callDate" value="" />
          <input type="hidden" name="callTime" value="" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <input type="hidden" name="reason" value="" />
          <div className="space-y-1.5">
            <Label htmlFor="callDate">{needsTime ? "Reschedule call to" : "Next call (optional)"}</Label>
            <DmyDateInput key={`d-${needsTime}`} name="callDate" defaultValue={needsTime ? tomorrowIst() : ""} aria-invalid={!!err.callDate} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="callTime">Time</Label>
            <Input key={`t-${needsTime}`} id="callTime" name="callTime" type="time" defaultValue={needsTime ? "11:00" : ""} />
          </div>
        </div>
      )}
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">
        {pending ? "Saving…" : outcome === "NotInterested" ? "Save and close lead" : outcome === "NoAnswer" ? "Save and reschedule" : "Save"}
      </Button>
    </form>
  );
}

/** Header badge: "N calls open"; opens the reminder. */
export function CallsBadge({ count }: { count: number }) {
  return (
    <button type="button" onClick={() => openCallReminder()}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-orange-100 px-3 text-sm font-medium whitespace-nowrap text-orange-800 hover:bg-orange-200">
      <PhoneIcon className="size-3.5" /> {count} {count === 1 ? "call" : "calls"} open
    </button>
  );
}
