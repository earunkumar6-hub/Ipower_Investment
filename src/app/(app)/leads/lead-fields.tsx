"use client";

import type { Gender, LeadSource } from "@prisma/client";
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import type { SummaryRow } from "@/components/confirm-save";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { addDays, isoDate, istToday } from "@/lib/dates";
import { GENDER_LABEL, LEAD_SOURCE_LABEL } from "@/lib/lead-labels";

export type LeadDetails = {
  firstName: string; lastName: string; dob: string; gender: Gender | ""; mobiles: { number: string; isWhatsApp: boolean }[];
  email: string; address: string; source: LeadSource | ""; referrerName: string; interest: string; notes: string;
};

export const EMPTY_LEAD: LeadDetails = {
  firstName: "", lastName: "", dob: "", gender: "", mobiles: [{ number: "", isWhatsApp: true }], email: "", address: "", source: "", referrerName: "", interest: "", notes: "",
};

export function Field({ label, name, error, required, ...props }: { label: string; name: string; error?: string; required?: boolean } & React.ComponentProps<"input">) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}{required && <span className="text-destructive"> *</span>}</Label>
      <Input id={name} name={name} aria-invalid={!!error} {...props} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Mobile numbers with "+ Add number" and a "Same as WhatsApp" tick on each. */
function Mobiles({ initial, error }: { initial: LeadDetails["mobiles"]; error?: string }) {
  const [rows, setRows] = useState(() => initial.map((m, i) => ({ ...m, key: i })));
  const [next, setNext] = useState(initial.length);
  return (
    <div className="space-y-1.5">
      <Label>Mobile number<span className="text-destructive"> *</span></Label>
      {rows.map((m, i) => (
        <div key={m.key} className="flex items-center gap-2">
          <Input name="mobile" defaultValue={m.number} inputMode="numeric" maxLength={10} placeholder={i === 0 ? "Main number" : `Mobile number ${i + 1}`}
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

/** First name, DOB, gender, mobiles, business type (+ referred by), interested product, email, address, notes. */
export function LeadDetailFields({ initial, err, products }: { initial: LeadDetails; err: Record<string, string>; products: string[] }) {
  const [source, setSource] = useState(initial.source);
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" name="firstName" defaultValue={initial.firstName} error={err.firstName} required />
        <Field label="Last name" name="lastName" defaultValue={initial.lastName} />
        <Field label="Date of birth" name="dob" type="date" defaultValue={initial.dob} max={isoDate(addDays(istToday(), -1))} error={err.dob} required />
        <div className="space-y-1.5">
          <Label htmlFor="gender">Gender<span className="text-destructive"> *</span></Label>
          <NativeSelect id="gender" name="gender" defaultValue={initial.gender} className="w-full" aria-invalid={!!err.gender}>
            <NativeSelectOption value="">Pick</NativeSelectOption>
            {Object.entries(GENDER_LABEL).map(([v, l]) => <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}
          </NativeSelect>
          {err.gender && <p className="text-xs text-destructive">{err.gender}</p>}
        </div>
      </div>
      <Mobiles initial={initial.mobiles} error={err.mobile} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="source">Business type<span className="text-destructive"> *</span></Label>
          <NativeSelect id="source" name="source" value={source} onChange={(e) => setSource(e.target.value as LeadSource)} className="w-full" aria-invalid={!!err.source}>
            <NativeSelectOption value="">Pick</NativeSelectOption>
            {Object.entries(LEAD_SOURCE_LABEL).map(([v, l]) => <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}
          </NativeSelect>
          {err.source && <p className="text-xs text-destructive">{err.source}</p>}
        </div>
        {source === "Referral"
          ? <Field label="Referred by (name)" name="referrerName" defaultValue={initial.referrerName} error={err.referrerName} required />
          : <input type="hidden" name="referrerName" value="" />}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="interest">Interested product</Label>
        <Input id="interest" name="interest" list="lead-products" defaultValue={initial.interest} placeholder="Pick from the list or type" />
        <datalist id="lead-products">{products.map((p) => <option key={p} value={p} />)}</datalist>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email" name="email" type="email" defaultValue={initial.email} error={err.email} />
        <Field label="Address" name="address" defaultValue={initial.address} maxLength={300} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={2} defaultValue={initial.notes} />
      </div>
    </>
  );
}

const fmtDob = (iso: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

/** Rows for the "Check before saving" pop-up. */
export function summarizeLead(form: FormData): SummaryRow[] {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const ticked = new Set(form.getAll("whatsApp").map(String));
  const mobiles = form.getAll("mobile").map((m, i) => ({ n: String(m).trim(), w: ticked.has(String(i)) })).filter((m) => m.n);
  const source = get("source") as LeadSource;
  return [
    ["Name", [get("firstName"), get("lastName")].filter(Boolean).join(" ")],
    ["Date of birth", fmtDob(get("dob"))],
    ["Gender", GENDER_LABEL[get("gender") as Gender] ?? ""],
    ["Mobile", mobiles.map((m) => `${m.n}${m.w ? " (WhatsApp)" : ""}`).join(", ")],
    ["Business type", source ? `${LEAD_SOURCE_LABEL[source]}${source === "Referral" && get("referrerName") ? ` – ${get("referrerName")}` : ""}` : ""],
    ["Interested product", get("interest")],
    ["Email", get("email")],
    ["Address", get("address")],
    ["Notes", get("notes")],
  ];
}
