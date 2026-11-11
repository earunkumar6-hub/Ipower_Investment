"use client";

import { useActionState, useState } from "react";
import { useConfirmBeforeSave, type SummaryRow } from "@/components/confirm-save";
import { DuplicateCustomerDialog } from "@/components/duplicate-customer-dialog";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { DmyDateInput } from "@/components/dmy-date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { isoToDmy } from "@/lib/dates";
import { SIP_DAYS, sipDateLabel } from "@/lib/products";
import { saveProposal } from "../actions";

/** Id of the proposal's one form: the account holders and Aadhaar / PAN boxes join it with the `form` attribute. */
export const PROPOSAL_FORM = "proposal-form";

/** Aadhaar / PAN with the consent tick – saved by "Save proposal" (owner, 3 Nov 2026). */
export function KycForm({ unlocked, panMasked, aadhaarLast4, consent, allowed }: {
  unlocked: boolean; panMasked: string | null; aadhaarLast4: string | null;
  /** "Customer consent taken" already recorded: "By R. Murali, 22 Oct 2026". */
  consent: string | null;
  /** May enter Aadhaar / PAN (PII.Edit). */
  allowed: boolean;
}) {
  const editable = unlocked && allowed;
  const [ticked, setTicked] = useState(!!consent);
  const open = editable && ticked;

  return (
    <div className="space-y-3">
      <label className="flex items-start gap-2 text-sm font-medium">
        <input type="checkbox" form={PROPOSAL_FORM} name="consent" checked={ticked} disabled={!!consent || !editable} onChange={(e) => setTicked(e.target.checked)} className="mt-0.5" />
        <span>Customer consent taken{consent && <span className="block text-xs font-normal text-muted-foreground">{consent}</span>}</span>
      </label>
      <div className="space-y-1.5">
        <Label htmlFor="aadhaar">Aadhaar</Label>
        <Input id="aadhaar" form={PROPOSAL_FORM} name="aadhaar" readOnly={!open} disabled={!open} inputMode="numeric" maxLength={14}
          placeholder={aadhaarLast4 ? `XXXX-XXXX-${aadhaarLast4}` : editable ? "12 digits (optional)" : "Not entered"} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pan">PAN</Label>
        <Input id="pan" form={PROPOSAL_FORM} name="pan" readOnly={!open} disabled={!open} maxLength={10} className="not-placeholder-shown:uppercase"
          placeholder={panMasked ?? (editable ? "ABCDE1234F (optional)" : "Not entered")} />
      </div>
      <p className="rounded-lg bg-slate-100 p-2 text-xs text-slate-700">
        Optional; needs the consent tick. Stored encrypted, shown masked (PAN ABCxxxxx4M, Aadhaar last 4). A number that already belongs to another customer is refused.
        {unlocked ? (allowed ? " Saved with “Save proposal”." : " Your role can't enter Aadhaar / PAN.") : " The policy is issued; they can't be changed here."}
      </p>
    </div>
  );
}

type Option = { id: string; name: string; tenureMonths: number | null };

const inr = (v: FormDataEntryValue | null) => `₹${Number(v).toLocaleString("en-IN")}`;

// "Check before saving" rows for the parts outside the details box (numbers masked, as everywhere else).
const aadhaarText = (v: FormDataEntryValue | null) => { const d = String(v ?? "").replace(/\D/g, ""); return d ? `Aadhaar XXXX-XXXX-${d.slice(-4)}` : ""; };
const panText = (v: FormDataEntryValue | null) => { const t = String(v ?? "").trim().toUpperCase(); return t ? `PAN ${t.slice(0, 3)}xxxxx${t.slice(-2)}` : ""; };
function holderRows(form: FormData): SummaryRow[] {
  if (!form.has("jointAccount")) return [];
  const get = (k: string) => String(form.get(k) ?? "").trim().toUpperCase();
  const postal = form.has("firstHolderCif"); // the CIF boxes are there only for post office products
  const folio: SummaryRow[] = form.has("folioNo") ? [["Folio number", get("folioNo") || "—"]] : [];
  if (form.get("jointAccount") !== "on") return [...(postal ? [["Holder CIF", get("firstHolderCif") || "—"] as SummaryRow] : []), ...folio];
  const second = form.get("secondHolderId") ? "existing customer picked" : [String(form.get("secondHolderName") ?? "").trim(), String(form.get("secondHolderMobile") ?? "").trim()].filter(Boolean).join(" · ");
  return [["Joint account", `second holder ${second || "—"}${postal ? ` · CIFs ${get("firstHolderCif") || "—"} / ${get("secondHolderCif") || "—"}` : ""}`], ...folio];
}

/**
 * Policy details (scheme, pay mode, term, premium paying term, start date) and the policy number with ONE Save
 * (owner, 3 Nov 2026). Blank policy number: the details are saved and it stays in Proposals; with a number the
 * policy is issued as well.
 */
export function ProposalForm({ proposalId, payModes, schemes, initial, showPpt, mf, insurance, amountLabel, children }: {
  proposalId: string; payModes: { value: string; label: string }[]; schemes: Option[]; showPpt: boolean;
  /** Money box label: Premium / Investment amount / Amount (post office schemes other than PLI). */
  amountLabel: string;
  /** Shown between the details and the policy number: the account holders panel. */
  children?: React.ReactNode;
  /** Mutual fund: a monthly (SIP) one needs the SIP date. */
  mf: boolean;
  /** Insurance: sum assured shown; * = needed before the policy number (life cover also term and PPT). */
  insurance: { health: boolean } | null;
  initial: { frequency: string; term: string; ppt: string; startDate: string; schemeId: string; sipDay: string; premium: string; sumInsured: string };
}) {
  const life = !!insurance && !insurance.health;
  const star = (on: boolean) => on && <span className="text-destructive"> *</span>;
  const startLabel = insurance ? "Date of commencement (DOC)" : "Start date";
  const [frequency, setFrequency] = useState(initial.frequency);
  const sip = mf && frequency === "Monthly";
  const [dup, setDup] = useState<ActionResult["duplicate"]>();
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await saveProposal(prev, form);
    if (r.ok) toast.success(r.message ?? "Saved");
    setDup(r.duplicate);
    return r;
  }, { ok: false });
  const confirm = useConfirmBeforeSave(action, (form) => [
    ["Scheme / plan", schemes.find((s) => s.id === form.get("schemeId"))?.name ?? ""],
    ["Pay mode", payModes.find((m) => m.value === form.get("frequency"))?.label ?? ""],
    [amountLabel, form.get("premium") ? inr(form.get("premium")) : ""],
    ...(insurance ? [["Sum assured", form.get("sumInsured") ? inr(form.get("sumInsured")) : ""] as SummaryRow] : []),
    ["Term", form.get("term") ? `${form.get("term")} years` : ""],
    ["Premium paying term", form.get("premiumPayingTerm") ? `${form.get("premiumPayingTerm")} years` : ""],
    [startLabel, isoToDmy(String(form.get("startDate") ?? ""))],
    ...(sip ? [["SIP date", form.get("sipDay") ? sipDateLabel(Number(form.get("sipDay"))) : ""] as SummaryRow] : []),
    ...holderRows(form),
    ...(form.get("aadhaar") || form.get("pan") || form.get("consent") === "on"
      ? [["Aadhaar / PAN", [form.get("consent") === "on" && "consent taken", aadhaarText(form.get("aadhaar")), panText(form.get("pan"))].filter(Boolean).join(" · ")] as SummaryRow] : []),
    // Mutual funds: the folio row above stands in for the policy number.
    ...(mf ? [] : [["Policy number", String(form.get("policyNumber") ?? "").trim().toUpperCase() || "Blank – stays in Proposals"] as SummaryRow]),
  ]);
  return (
    <form id={PROPOSAL_FORM} onSubmit={confirm.onSubmit} className="space-y-4">
      <input type="hidden" name="proposalId" value={proposalId} />
      <div className="rounded-lg border p-3">
      <h3 className="mb-2 text-sm font-medium">Policy details</h3>
      <div className="grid grid-cols-5 items-end gap-2">
        {schemes.length > 0 ? (
          <div className="space-y-1.5">
            <Label htmlFor="schemeId">{insurance ? "Plan" : "Scheme / plan"}{star(!!insurance)}</Label>
            <NativeSelect id="schemeId" name="schemeId" defaultValue={initial.schemeId} className="w-full">
              <NativeSelectOption value=""></NativeSelectOption>
              {schemes.map((s) => <NativeSelectOption key={s.id} value={s.id}>{s.name}</NativeSelectOption>)}
            </NativeSelect>
          </div>
        ) : <input type="hidden" name="schemeId" value="" />}
        <div className="space-y-1.5">
          <Label htmlFor="frequency">Pay mode</Label>
          <NativeSelect id="frequency" name="frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)} className="w-full">
            <NativeSelectOption value=""></NativeSelectOption>
            {payModes.map((m) => <NativeSelectOption key={m.value} value={m.value}>{m.label}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <div className="space-y-1.5"><Label htmlFor="premium">{amountLabel}{star(!!insurance)}</Label><Input id="premium" name="premium" inputMode="decimal" defaultValue={initial.premium} /></div>
        {insurance && <div className="space-y-1.5"><Label htmlFor="sumInsured">Sum assured (SA){star(true)}</Label><Input id="sumInsured" name="sumInsured" inputMode="decimal" defaultValue={initial.sumInsured} placeholder="e.g. 1000000" /></div>}
        <div className="space-y-1.5"><Label htmlFor="term">Term (years){star(life)}</Label><Input id="term" name="term" inputMode="decimal" defaultValue={initial.term} placeholder="e.g. 5" /></div>
        {showPpt
          ? <div className="space-y-1.5"><Label htmlFor="premiumPayingTerm">Premium paying term (PPT, years){star(life)}</Label><Input id="premiumPayingTerm" name="premiumPayingTerm" inputMode="decimal" defaultValue={initial.ppt} /></div>
          : <input type="hidden" name="premiumPayingTerm" value="" />}
        <div className="space-y-1.5"><Label htmlFor="startDate">{startLabel}{star(!!insurance)}</Label><DmyDateInput name="startDate" defaultValue={initial.startDate} /></div>
        {sip ? (
          <div className="space-y-1.5">
            <Label htmlFor="sipDay">SIP date<span className="text-destructive"> *</span></Label>
            <NativeSelect id="sipDay" name="sipDay" defaultValue={initial.sipDay} className="w-full">
              <NativeSelectOption value=""></NativeSelectOption>
              {SIP_DAYS.map((d) => <NativeSelectOption key={d} value={d}>{sipDateLabel(d)}</NativeSelectOption>)}
            </NativeSelect>
          </div>
        ) : <input type="hidden" name="sipDay" value="" />}
      </div>
      {insurance && <p className="mt-2 text-xs text-muted-foreground">* needed before the policy number can be saved.</p>}
      </div>
      {children}
      <div className="space-y-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-end gap-2">
          {/* Mutual funds have no policy number box: the folio number under Account holders issues them (owner, 6 Nov 2026). */}
          {!mf && (
            <div className="space-y-1.5">
              <Label htmlFor="policyNumber">Policy number (leave blank until issued)</Label>
              <Input id="policyNumber" name="policyNumber" className="w-64 not-placeholder-shown:uppercase" placeholder="e.g. STAR-P-700123" />
            </div>
          )}
          <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save proposal"}</Button>
        </div>
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        <p className="text-xs text-muted-foreground">Saves the policy details, account holders and Aadhaar / PAN. {mf ? "Folio number" : "Policy number"} blank: the record stays in Proposals and no bills are made. With the number it moves to Partners / Customers and the renewal schedule is created from pay mode and term.</p>
      </div>
      {confirm.dialog}
      <DuplicateCustomerDialog duplicate={dup} onClose={() => setDup(undefined)} />
    </form>
  );
}
