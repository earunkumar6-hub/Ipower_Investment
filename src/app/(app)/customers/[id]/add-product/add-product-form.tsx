"use client";

import type { CustomFieldType, Frequency, InvoiceRule, ProductType } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { useConfirmBeforeSave, type SummaryRow } from "@/components/confirm-save";
import { DuplicateCustomerDialog } from "@/components/duplicate-customer-dialog";
import { Button } from "@/components/ui/button";
import { DmyDateInput } from "@/components/dmy-date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { isoToDmy } from "@/lib/dates";
import { BANK_FIELDS, BILLED_FROM_AMOUNT, fmtTenure, isHealthCover, isPostal, isPostalInvestmentType, needsSipDay, payModeLabel, PRODUCT_TYPE_LABEL, SIP_DAYS, sipDateLabel, type BankField } from "@/lib/products";
import { addProductDirect } from "../../actions";

export type CatalogueProduct = {
  id: string; name: string; partner: string; productType: ProductType; invoiceRule: InvoiceRule; payModes: Frequency[]; lockInMonths: number | null;
  fields: string[]; requiredFields: string[]; bankDetailsRequired: boolean; bankFields: string[];
  schemes: { id: string; name: string; tenureMonths: number | null; rates: { rate: string; from: string }[] }[];
  customFields: { id: string; label: string; type: CustomFieldType; options: string[]; required: boolean }[];
};

const addMonthsIso = (iso: string, m: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, d.getUTCDate()));
  return t.toISOString().slice(0, 10);
};
const fmt = (iso: string) => isoToDmy(iso) || "—";
const rateOn = (rates: { rate: string; from: string }[], on: string) => [...rates].filter((r) => r.from <= on).sort((a, b) => b.from.localeCompare(a.from))[0]?.rate ?? null;

function Field({ label, name, required, error, children }: { label: string; name: string; required?: boolean; error?: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}{required && <span className="text-destructive"> *</span>}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function AddProductForm({ customerId, customerName, products, today }: { customerId: string; customerName: string; products: CatalogueProduct[]; today: string }) {
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [schemeId, setSchemeId] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [term, setTerm] = useState("");
  const [frequency, setFrequency] = useState("");
  const product = products.find((p) => p.id === productId);
  const scheme = product?.schemes.find((s) => s.id === schemeId);
  const termMonths = scheme?.tenureMonths ?? (term ? Math.round(Number(term) * 12) : null);
  const rate = scheme ? rateOn(scheme.rates, startDate) : null;
  const maturity = termMonths && startDate ? addMonthsIso(startDate, termMonths) : "";
  const lockIn = product?.lockInMonths && startDate ? addMonthsIso(startDate, product.lockInMonths) : "";
  const shown = (f: string) => !!product?.fields.includes(f);
  const needed = (f: string) => !!product?.requiredFields.includes(f);
  const mf = product?.productType === "MutualFund";
  const payMode = frequency || product?.payModes[0] || "";
  const sip = needsSipDay(product?.productType, payMode);
  // Insurance with a policy number needs sum assured; life cover also term and premium paying term (3 Nov 2026).
  const insurance = product?.productType === "Insurance";
  const postal = !!product && isPostal(product); // holder CIF from the post office (owner, 4 Nov 2026)
  const amountOptional = isPostalInvestmentType(product?.productType); // every post office scheme: amount may be blank (owner, 11 Nov 2026)
  const [dup, setDup] = useState<ActionResult["duplicate"]>();
  const life = insurance && !isHealthCover({ invoiceRule: product?.invoiceRule });

  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await addProductDirect(prev, form);
    setDup(r.duplicate);
    if (r.ok) {
      toast.success(r.message ?? "Saved");
      router.push(r.href!);
    }
    return r;
  }, { ok: false });
  const err = state.fieldErrors ?? {};

  const confirm = useConfirmBeforeSave(action, (form): SummaryRow[] => {
    const get = (k: string) => String(form.get(k) ?? "").trim();
    if (!product) return [["Product", "—"]];
    return [
      ["Customer", customerName],
      ["Product", `${product.partner} · ${product.name}${scheme ? ` · ${scheme.name}` : ""}`],
      ["Policy / account no.", get("policyNumber") || "Blank – saved in Proposals until issued"],
      ...(mf ? [["Folio number", get("folioNo").toUpperCase()] as SummaryRow] : []),
      ...(postal ? [["Holder CIF (post office)", get("firstHolderCif").toUpperCase()] as SummaryRow] : []),
      [mf ? "Investment amount" : "Amount / premium", get("amount") && `₹${Number(get("amount")).toLocaleString("en-IN")} · ${get("frequency") ? payModeLabel(get("frequency") as Frequency, mf) : ""}`],
      ["Commenced", fmt(get("startDate"))],
      ...(sip ? [["SIP date", get("sipDay") && sipDateLabel(Number(get("sipDay")))] as SummaryRow] : []),
      ["Term", termMonths ? `${fmtTenure(termMonths)}${maturity ? ` · matures ${fmt(maturity)}` : ""}` : ""],
      ["Interest rate", rate ? `${rate}%` : ""],
      ["Premium paying term", get("premiumPayingTerm") && `${get("premiumPayingTerm")} years`],
      ["Nominee", get("nominee")],
      ...(product.bankDetailsRequired ? [["Bank", [get("bank_bank"), get("bank_branch"), get("bank_ifsc"), get("bank_micr") && `MICR ${get("bank_micr")}`, get("bank_accountType"), get("bank_accountNo") && `A/c ••${get("bank_accountNo").slice(-4)}`].filter(Boolean).join(" · ")] as SummaryRow] : []),
      ...product.customFields.map((f): SummaryRow => [f.label, get(`cf_${f.id}`)]),
    ];
  });

  return (
    <form onSubmit={confirm.onSubmit} className="space-y-4">
      <input type="hidden" name="customerId" value={customerId} />
      {/* Save at the top and the bottom: both run the same check-before-saving pop-up. */}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !product} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save product"}</Button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Product" name="productId" required error={err.productId}>
          <NativeSelect id="productId" name="productId" value={productId} onChange={(e) => { setProductId(e.target.value); setSchemeId(""); setTerm(""); setFrequency(""); }} className="w-full">
            <NativeSelectOption value=""></NativeSelectOption>
            {products.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.partner} · {p.name} ({PRODUCT_TYPE_LABEL[p.productType]})</NativeSelectOption>)}
          </NativeSelect>
        </Field>
        {product && product.schemes.length > 0 && (
          <Field label="Scheme / tenure" name="schemeId" required error={err.schemeId}>
            <NativeSelect id="schemeId" name="schemeId" value={schemeId} onChange={(e) => setSchemeId(e.target.value)} className="w-full">
              <NativeSelectOption value=""></NativeSelectOption>
              {product.schemes.map((s) => <NativeSelectOption key={s.id} value={s.id}>{s.name}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
        )}
        <Field label="Policy / account number" name="policyNumber" error={err.policyNumber}>
          <Input id="policyNumber" name="policyNumber" placeholder="Leave blank until issued" className="not-placeholder-shown:uppercase" />
        </Field>
      </div>

      {product && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <Field label={mf ? "Investment amount" : amountOptional ? "Amount" : "Amount / premium"} name="amount" required={!amountOptional} error={err.amount}><Input id="amount" name="amount" inputMode="decimal" placeholder={mf ? "5000" : amountOptional ? (product && BILLED_FROM_AMOUNT[product.productType] ? "needed with the policy no." : "optional") : "100000"} /></Field>
            <Field label={mf ? "SIP / Lumpsum" : "Pay mode"} name="frequency" required error={err.frequency}>
              <NativeSelect id="frequency" name="frequency" value={payMode} onChange={(e) => setFrequency(e.target.value)} className="w-full">
                {product.payModes.map((m) => <NativeSelectOption key={m} value={m}>{payModeLabel(m, mf)}</NativeSelectOption>)}
              </NativeSelect>
            </Field>
            <Field label="Date of commencement" name="startDate" required error={err.startDate}>
              <DmyDateInput name="startDate" value={startDate} onChange={setStartDate} />
            </Field>
            {sip ? (
              <Field label="SIP date" name="sipDay" required error={err.sipDay}>
                <NativeSelect id="sipDay" name="sipDay" defaultValue="" className="w-full">
                  <NativeSelectOption value=""></NativeSelectOption>
                  {SIP_DAYS.map((d) => <NativeSelectOption key={d} value={d}>{sipDateLabel(d)}</NativeSelectOption>)}
                </NativeSelect>
              </Field>
            ) : <input type="hidden" name="sipDay" value="" />}
            {scheme?.tenureMonths ? (
              <Field label="Term" name="term"><div className="flex h-8 items-center text-sm">{fmtTenure(scheme.tenureMonths)} <span className="ml-1 text-xs text-muted-foreground">(from scheme)</span></div><input type="hidden" name="term" value="" /></Field>
            ) : (
              <Field label="Term (years)" name="term" required={life} error={err.term}><Input id="term" name="term" inputMode="decimal" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={life ? "e.g. 20" : "blank = open-ended"} /></Field>
            )}
          </div>

          <div className="grid grid-cols-4 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
            <div><div className="text-xs text-muted-foreground">Interest rate</div>{rate ? `${rate}% (rate in force on the start date)` : "—"}</div>
            <div><div className="text-xs text-muted-foreground">Maturity date (auto)</div>{fmt(maturity)}</div>
            <div><div className="text-xs text-muted-foreground">Lock-in until (auto)</div>{lockIn ? fmt(lockIn) : "No lock-in"}</div>
            <div><div className="text-xs text-muted-foreground">Bills</div>{product.payModes.includes("OneTime") && product.payModes.length === 1 ? "None – one-time deposit" : "Per pay mode"}</div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {insurance && <Field label="Sum assured (SA)" name="sumAssured" required error={err.sumAssured}><Input id="sumAssured" name="sumAssured" inputMode="decimal" placeholder="e.g. 1000000" /></Field>}
            {shown("premiumPayingTerm") && (
              <Field label="Premium paying term (PPT, years)" name="premiumPayingTerm" required={needed("premiumPayingTerm") || life} error={err.premiumPayingTerm}>
                <Input id="premiumPayingTerm" name="premiumPayingTerm" inputMode="decimal" />
              </Field>
            )}
            {postal && <Field label="Holder CIF (given by the post office)" name="firstHolderCif" error={err.firstHolderCif}><Input id="firstHolderCif" name="firstHolderCif" placeholder="optional" className="not-placeholder-shown:uppercase" /></Field>}
            {mf && <Field label="Folio number" name="folioNo" error={err.folioNo}><Input id="folioNo" name="folioNo" placeholder="from the AMC (optional)" className="not-placeholder-shown:uppercase" /></Field>}
            {shown("nominee") && <Field label="Nominee" name="nominee" required={needed("nominee")} error={err.nominee}><Input id="nominee" name="nominee" /></Field>}
            {product.customFields.map((f) => (
              <Field key={f.id} label={f.label} name={`cf_${f.id}`} required={f.required} error={err[`cf_${f.id}`]}>
                {f.type === "Dropdown" ? (
                  <NativeSelect id={`cf_${f.id}`} name={`cf_${f.id}`} defaultValue="" className="w-full">
                    <NativeSelectOption value=""></NativeSelectOption>
                    {f.options.map((o) => <NativeSelectOption key={o} value={o}>{o}</NativeSelectOption>)}
                  </NativeSelect>
                ) : f.type === "Date" ? <DmyDateInput name={`cf_${f.id}`} />
                  : <Input id={`cf_${f.id}`} name={`cf_${f.id}`} inputMode={f.type === "Number" ? "decimal" : undefined} />}
              </Field>
            ))}
          </div>

          {product.bankDetailsRequired && (
            <div className="rounded-lg border p-3">
              <h3 className="mb-2 text-sm font-medium">Bank account (required for this product) <span className="text-xs font-normal text-muted-foreground">– stored encrypted</span></h3>
              <div className="grid grid-cols-3 gap-3">
                {(product.bankFields as BankField[]).map((k) => (
                  <Field key={k} label={BANK_FIELDS[k]} name={`bank_${k}`} required error={err[`bank_${k}`]}>
                    {k === "accountType" ? (
                      <NativeSelect id="bank_accountType" name="bank_accountType" defaultValue="" className="w-full">
                        <NativeSelectOption value=""></NativeSelectOption>
                        <NativeSelectOption value="Savings">Savings</NativeSelectOption>
                        <NativeSelectOption value="Current">Current</NativeSelectOption>
                      </NativeSelect>
                    ) : (
                      <Input id={`bank_${k}`} name={`bank_${k}`} inputMode={k === "accountNo" || k === "micr" ? "numeric" : undefined} maxLength={k === "micr" ? 9 : undefined} className={k === "ifsc" ? "uppercase" : undefined} />
                    )}
                  </Field>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || !product} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save product"}</Button>
        <p className="text-xs text-muted-foreground">With a policy number it is saved here as Active and its renewal schedule is created. Leave it blank and it waits in Proposals.</p>
      </div>
      {confirm.dialog}
      <DuplicateCustomerDialog duplicate={dup} onClose={() => setDup(undefined)} />
    </form>
  );
}
