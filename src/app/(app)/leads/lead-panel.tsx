"use client";

import type { CallOutcome, LeadStage, LeadStatus } from "@prisma/client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { GENDER_LABEL, LEAD_SOURCE_LABEL, LEAD_STAGE_LABEL, LEAD_STATUS_LABEL, LEAD_STATUS_TONE, OUTCOME_LABEL } from "@/lib/lead-labels";
import { submitKeepingValues } from "@/lib/form";
import { updateLead, type ActionResult } from "./actions";
import { EditLeadDialog } from "./add-lead-dialog";
import type { LeadDetails } from "./lead-fields";

type PanelLead = {
  id: string;
  leadNo: string;
  name: string;
  details: LeadDetails; // for Edit
  dobLabel: string | null; // "12/03/1985"
  status: LeadStatus;
  stage: LeadStage;
  notInterestedReason: string | null;
  ownerName: string;
  calls: { id: string; dueAt: string; note: string | null; outcome: CallOutcome | null; outcomeNote: string | null }[];
};

const IST = "Asia/Kolkata";
const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST });
const istParts = (iso: string) => {
  const local = new Date(new Date(iso).getTime() + 5.5 * 3_600_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
};

export function LeadPanel({ lead, products }: { lead: PanelLead; products: string[] }) {
  const d = lead.details;
  const openCall = [...lead.calls].reverse().find((c) => !c.outcome);
  const next = openCall ? istParts(openCall.dueAt) : { date: "", time: "" };
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const result = await updateLead(prev, form);
    if (result.ok) toast.success(`${lead.leadNo} updated`);
    return result;
  }, { ok: false });
  const err = state.fieldErrors ?? {};
  const closed = status === "NotInterested";

  return (
    <aside className="w-80 shrink-0 space-y-4 rounded-xl border bg-white p-4">
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-semibold">{lead.leadNo} · {lead.name}</h2>
          <EditLeadDialog leadId={lead.id} leadNo={lead.leadNo} initial={d} products={products} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <StatusBadge tone={LEAD_STATUS_TONE[lead.status]}>{LEAD_STATUS_LABEL[lead.status]}</StatusBadge>
          <span className="text-muted-foreground">Stage: {LEAD_STAGE_LABEL[lead.stage]}</span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pt-1 text-xs">
          <dt className="text-muted-foreground">Mobile</dt>
          <dd>{d.mobiles.map((m) => `${m.number}${m.isWhatsApp ? " (WhatsApp)" : ""}`).join(", ")}</dd>
          {lead.dobLabel && <><dt className="text-muted-foreground">DOB</dt><dd>{lead.dobLabel}{d.gender && ` · ${GENDER_LABEL[d.gender]}`}</dd></>}
          {!lead.dobLabel && d.gender && <><dt className="text-muted-foreground">Gender</dt><dd>{GENDER_LABEL[d.gender]}</dd></>}
          {d.source && <><dt className="text-muted-foreground">Business type</dt><dd>{LEAD_SOURCE_LABEL[d.source]}{d.referrerName && ` – ${d.referrerName}`}</dd></>}
          {d.interest && <><dt className="text-muted-foreground">Interested in</dt><dd>{d.interest}</dd></>}
          {d.email && <><dt className="text-muted-foreground">Email</dt><dd>{d.email}</dd></>}
          {d.address && <><dt className="text-muted-foreground">Address</dt><dd>{d.address}</dd></>}
          {d.notes && <><dt className="text-muted-foreground">Notes</dt><dd className="whitespace-pre-line">{d.notes}</dd></>}
          <dt className="text-muted-foreground">Owner</dt><dd>{lead.ownerName}</dd>
        </dl>
        {lead.notInterestedReason && <p className="text-xs text-orange-700">Not interested: {lead.notInterestedReason}</p>}
      </div>

      <form onSubmit={submitKeepingValues(action)} className="space-y-3">
        <input type="hidden" name="leadId" value={lead.id} />
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <NativeSelect id="status" name="status" value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)} className="w-full">
            {Object.entries(LEAD_STATUS_LABEL).map(([v, l]) => <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}
          </NativeSelect>
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
              <Label htmlFor="callDate">{status === "CallBack" ? "Call back on" : "Next follow-up"}</Label>
              <Input id="callDate" name="callDate" type="date" defaultValue={next.date} aria-invalid={!!err.callDate} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="callTime">Time</Label>
              <Input id="callTime" name="callTime" type="time" defaultValue={next.time} />
            </div>
          </div>
        )}
        {!closed && openCall && (
          <p className="rounded-lg bg-saffron-50 p-2 text-xs text-saffron-900">
            At the follow-up time a call reminder pops up for {lead.ownerName} on every screen and stays open until an outcome is saved or the call is rescheduled.
          </p>
        )}
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        <Button type="submit" disabled={pending} className="w-full bg-brand-600 hover:bg-brand-700">
          {pending ? "Saving…" : closed ? "Close lead" : openCall ? "Save / reschedule call" : "Save"}
        </Button>
      </form>

      {lead.status !== "NotInterested" && lead.stage !== "Customer" && (
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
