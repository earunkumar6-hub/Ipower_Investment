"use client";

import type { CallOutcome, LeadSource, LeadStatus } from "@prisma/client";
import { useActionState, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { LEAD_SOURCE_LABEL, LEAD_STATUS_LABEL } from "@/lib/lead-labels";
import { submitKeepingValues } from "@/lib/form";
import { updateLead, type ActionResult } from "./actions";

type PanelLead = {
  id: string;
  leadNo: string;
  name: string;
  mobile: string;
  email: string | null;
  dob: string | null; // "12 Mar 1985"
  address: string | null;
  onWhatsApp: boolean;
  source: LeadSource;
  status: LeadStatus;
  interest: string | null;
  notInterestedReason: string | null;
  ownerName: string;
  calls: { id: string; dueAt: string; note: string | null; outcome: CallOutcome | null; outcomeNote: string | null }[];
};

const OUTCOME_LABEL: Record<CallOutcome, string> = { Interested: "Interested", NoAnswer: "No answer", NotInterested: "Not interested" };
const SYSTEM_STATUSES: LeadStatus[] = ["Quoted", "Converted"];
const IST = "Asia/Kolkata";
const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST });
const istParts = (iso: string) => {
  const local = new Date(new Date(iso).getTime() + 5.5 * 3_600_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
};

export function LeadPanel({ lead }: { lead: PanelLead }) {
  const openCall = [...lead.calls].reverse().find((c) => !c.outcome);
  const next = openCall ? istParts(openCall.dueAt) : { date: "", time: "" };
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const result = await updateLead(prev, form);
    if (result.ok) toast.success(`${lead.leadNo} updated`);
    return result;
  }, { ok: false });
  const err = state.fieldErrors ?? {};
  const locked = SYSTEM_STATUSES.includes(lead.status);
  const closed = status === "NotInterested";

  return (
    <aside className="w-80 shrink-0 space-y-4 rounded-xl border bg-white p-4">
      <div>
        <h2 className="font-semibold">{lead.leadNo} · {lead.name}</h2>
        <p className="text-xs text-muted-foreground">
          {lead.mobile}{lead.onWhatsApp && " (WhatsApp)"}{lead.email && ` · ${lead.email}`} · {LEAD_SOURCE_LABEL[lead.source]} · Owner: {lead.ownerName}
        </p>
        {(lead.dob || lead.address) && (
          <p className="mt-1 text-xs text-muted-foreground">{[lead.dob && `DOB ${lead.dob}`, lead.address].filter(Boolean).join(" · ")}</p>
        )}
        {lead.interest && <p className="mt-1 text-xs">Interest: {lead.interest}</p>}
        {lead.notInterestedReason && <p className="mt-1 text-xs text-orange-700">Not interested: {lead.notInterestedReason}</p>}
      </div>

      <form onSubmit={submitKeepingValues(action)} className="space-y-3">
        <input type="hidden" name="leadId" value={lead.id} />
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          {locked ? (
            <>
              <input type="hidden" name="status" value={lead.status} />
              <p className="text-sm">{LEAD_STATUS_LABEL[lead.status]} <span className="text-xs text-muted-foreground">(set by quotation / proposal)</span></p>
            </>
          ) : (
            <NativeSelect id="status" name="status" value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)} className="w-full">
              {Object.entries(LEAD_STATUS_LABEL)
                .filter(([v]) => !SYSTEM_STATUSES.includes(v as LeadStatus))
                .map(([v, l]) => <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}
            </NativeSelect>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="note">{closed ? "Reason" : "Call note"}</Label>
          <Textarea id="note" name="note" rows={2} defaultValue={closed ? "" : openCall?.note ?? ""} aria-invalid={!!err.note} />
        </div>
        {closed ? (
          <>
            <input type="hidden" name="callDate" value="" />
            <input type="hidden" name="callTime" value="" />
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="callDate">Next follow-up</Label>
              <Input id="callDate" name="callDate" type="date" defaultValue={next.date} aria-invalid={!!err.callDate} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="callTime">Time</Label>
              <Input id="callTime" name="callTime" type="time" defaultValue={next.time} />
            </div>
          </div>
        )}
        {!closed && openCall && (
          <p className="rounded-lg bg-blue-50 p-2 text-xs text-blue-900">
            At the follow-up time a call reminder pops up for {lead.ownerName} on every screen and stays open until an outcome is saved or the call is rescheduled.
          </p>
        )}
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        <Button type="submit" disabled={pending} className="w-full bg-blue-600 hover:bg-blue-700">
          {pending ? "Saving…" : closed ? "Close lead" : openCall ? "Save / reschedule call" : "Save"}
        </Button>
      </form>

      {!["NotInterested", "Converted"].includes(lead.status) && (
        <Link href={`/quotations/new?leadId=${lead.id}`} className={buttonVariants({ variant: "outline", className: "w-full" })}>Create quotation</Link>
      )}
      <p className="text-xs text-muted-foreground">Aadhaar and PAN are not collected at lead stage.</p>

      {lead.calls.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">Calls</h3>
          <ul className="space-y-2 text-xs">
            {lead.calls.map((c) => (
              <li key={c.id} className="border-l-2 pl-2">
                <div className="font-medium">{fmt(c.dueAt)} · {c.outcome ? OUTCOME_LABEL[c.outcome] : "Open"}</div>
                {(c.outcomeNote ?? c.note) && <div className="text-muted-foreground">{c.outcomeNote ?? c.note}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
