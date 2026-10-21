"use client";

import type { CustomFieldType, Frequency, InvoiceRule, ProductType } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { submitKeepingValues } from "@/lib/form";
import { ACCOUNT_FIELDS, BANK_FIELDS, CUSTOM_FIELD_TYPE_LABEL, INVOICE_RULE_LABEL, PAY_MODE_LABEL, PAY_MODES, PRODUCT_TYPE_LABEL } from "@/lib/products";
import { addCustomField, addRate, removeCustomField, saveProduct, saveScheme } from "./actions";

/** Shared submit handling: toast on success, keep the typed values on an error. */
function useSettingsAction(action: (prev: ActionResult, form: FormData) => Promise<ActionResult>, success: string, onSuccess?: (r: ActionResult) => void) {
  return useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await action(prev, form);
    if (r.ok) {
      toast.success(success);
      onSuccess?.(r);
    }
    return r;
  }, { ok: false });
}

const FormError = ({ state }: { state: ActionResult }) => (state.error ? <p className="text-sm text-destructive">{state.error}</p> : null);

function Check({ name, value, label, defaultChecked }: { name: string; value?: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value={value ?? "on"} defaultChecked={defaultChecked} className="size-4 accent-brand-600" /> {label}
    </label>
  );
}

export type ProductValues = {
  id?: string; name: string; productType: ProductType; partner: string; invoiceRule: InvoiceRule; payModes: Frequency[];
  lockInMonths: number | null; bankDetailsRequired: boolean; bankFields: string[]; prematureClosure: boolean; closeDuringLockIn: boolean;
  fields: string[]; requiredFields: string[]; active: boolean;
};

export function ProductForm({ product }: { product: ProductValues }) {
  const router = useRouter();
  const isNew = !product.id;
  const [state, action, pending] = useSettingsAction(saveProduct, isNew ? "Product added" : "Product saved", (r) => {
    if (isNew && r.href) router.push(r.href);
  });
  const [type, setType] = useState(product.productType);
  const [bank, setBank] = useState(product.bankDetailsRequired);

  return (
    <form onSubmit={submitKeepingValues(action)} className="space-y-4">
      {product.id && <input type="hidden" name="id" value={product.id} />}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5"><Label htmlFor="name">Product name</Label><Input id="name" name="name" defaultValue={product.name} placeholder="Post Office TD" /></div>
        <div className="space-y-1.5">
          <Label htmlFor="productType">Category</Label>
          <NativeSelect id="productType" name="productType" value={type} onChange={(e) => setType(e.target.value as ProductType)} className="w-full">
            {Object.entries(PRODUCT_TYPE_LABEL).map(([k, l]) => <NativeSelectOption key={k} value={k}>{l}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <div className="space-y-1.5"><Label htmlFor="partner">Partner</Label><Input id="partner" name="partner" defaultValue={product.partner} placeholder="Post Office, LIC, Star Health…" /></div>
        <div className="space-y-1.5">
          <Label htmlFor="invoiceRule">Bills (invoice rule)</Label>
          <NativeSelect id="invoiceRule" name="invoiceRule" defaultValue={product.invoiceRule} className="w-full">
            {Object.entries(INVOICE_RULE_LABEL).map(([k, l]) => <NativeSelectOption key={k} value={k}>{l}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <div className="space-y-1.5"><Label htmlFor="lockInMonths">Lock-in period (months)</Label><Input id="lockInMonths" name="lockInMonths" inputMode="numeric" defaultValue={product.lockInMonths ?? ""} placeholder="e.g. 6 – blank for none" /></div>
        <div className="space-y-1.5">
          <Label>Pay modes</Label>
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
            {PAY_MODES.map((m) => <Check key={m} name="payModes" value={m} label={PAY_MODE_LABEL[m]} defaultChecked={product.payModes.includes(m)} />)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 rounded-lg border p-3">
        <div className="space-y-1.5">
          <div className="text-sm font-medium">Fields on the account</div>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Field</span><span className="text-xs text-muted-foreground">Shown</span><span className="text-xs text-muted-foreground">Required</span>
            {Object.entries(ACCOUNT_FIELDS).map(([k, l]) => (
              <FieldRow key={k} k={k} label={l} shown={product.fields.includes(k)} required={product.requiredFields.includes(k)} />
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="text-sm font-medium">Bank and closure</div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="bankDetailsRequired" checked={bank} onChange={(e) => setBank(e.target.checked)} className="size-4 accent-brand-600" /> Bank details required
          </label>
          {bank && (
            <div className="ml-6 space-y-1">
              {Object.entries(BANK_FIELDS).map(([k, l]) => <Check key={k} name="bankFields" value={k} label={l} defaultChecked={product.bankFields.length ? product.bankFields.includes(k) : true} />)}
              <p className="text-xs text-muted-foreground">Stored encrypted.</p>
            </div>
          )}
          {type === "MutualFund"
            ? <p className="text-xs text-muted-foreground">Mutual funds are withdrawn with a withdraw date, not closed early.</p>
            : <>
                <Check name="prematureClosure" label="Premature closure allowed" defaultChecked={product.prematureClosure} />
                <Check name="closeDuringLockIn" label="Can be closed during the lock-in period" defaultChecked={product.closeDuringLockIn} />
              </>}
        </div>
        <div className="space-y-1.5">
          <div className="text-sm font-medium">Status</div>
          <Check name="active" label="Active – can be picked for new accounts" defaultChecked={product.active} />
        </div>
      </div>

      <FormError state={state} />
      <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : isNew ? "Add product" : "Save product"}</Button>
    </form>
  );
}

function FieldRow({ k, label, shown, required }: { k: string; label: string; shown: boolean; required: boolean }) {
  const [on, setOn] = useState(shown);
  return (
    <>
      <span>{label}</span>
      <input type="checkbox" name="fields" value={k} checked={on} onChange={(e) => setOn(e.target.checked)} aria-label={`Show ${label}`} className="size-4 justify-self-center accent-brand-600" />
      <input type="checkbox" name="requiredFields" value={k} defaultChecked={required} disabled={!on} aria-label={`${label} required`} className="size-4 justify-self-center accent-brand-600" />
    </>
  );
}

export function AddSchemeForm({ productId, today }: { productId: string; today: string }) {
  const [key, setKey] = useState(0);
  const [state, action, pending] = useSettingsAction(saveScheme, "Scheme added", () => setKey((k) => k + 1));
  return (
    <form key={key} onSubmit={submitKeepingValues(action)} className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3">
      <input type="hidden" name="productId" value={productId} />
      <div className="space-y-1.5"><Label htmlFor="scheme-name">Scheme / tenure</Label><Input id="scheme-name" name="name" placeholder="TD 2 years" className="w-40" /></div>
      <TenureInputs />
      <div className="space-y-1.5"><Label htmlFor="scheme-rate">Interest rate %</Label><Input id="scheme-rate" name="rate" inputMode="decimal" placeholder="7.0 – optional" className="w-28" /></div>
      <div className="space-y-1.5"><Label htmlFor="scheme-from">Rate from</Label><Input id="scheme-from" name="effectiveFrom" type="date" defaultValue={today} className="w-36" /></div>
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Adding…" : "+ Add scheme"}</Button>
      <div className="w-full"><FormError state={state} /></div>
    </form>
  );
}

function TenureInputs({ months }: { months?: number | null }) {
  const inYears = !months || months % 12 === 0;
  return (
    <div className="space-y-1.5">
      <Label htmlFor="scheme-tenure">Tenure</Label>
      <div className="flex gap-1">
        <Input id="scheme-tenure" name="tenure" inputMode="numeric" defaultValue={months ? (inYears ? months / 12 : months) : ""} placeholder="blank = open" className="w-24" />
        <NativeSelect name="tenureUnit" defaultValue={inYears ? "years" : "months"} aria-label="Tenure unit">
          <NativeSelectOption value="years">years</NativeSelectOption>
          <NativeSelectOption value="months">months</NativeSelectOption>
        </NativeSelect>
      </div>
    </div>
  );
}

export function EditSchemeForm({ productId, scheme, onDone }: { productId: string; scheme: { id: string; name: string; tenureMonths: number | null; active: boolean }; onDone?: () => void }) {
  const [state, action, pending] = useSettingsAction(saveScheme, "Scheme saved", onDone);
  return (
    <form onSubmit={submitKeepingValues(action)} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="schemeId" value={scheme.id} />
      <div className="space-y-1.5"><Label htmlFor={`n-${scheme.id}`}>Name</Label><Input id={`n-${scheme.id}`} name="name" defaultValue={scheme.name} className="w-40" /></div>
      <TenureInputs months={scheme.tenureMonths} />
      <div className="space-y-1.5">
        <Label htmlFor={`a-${scheme.id}`}>Status</Label>
        <NativeSelect id={`a-${scheme.id}`} name="active" defaultValue={scheme.active ? "on" : "off"}>
          <NativeSelectOption value="on">Active</NativeSelectOption>
          <NativeSelectOption value="off">Inactive</NativeSelectOption>
        </NativeSelect>
      </div>
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      <div className="w-full"><FormError state={state} /></div>
    </form>
  );
}

export function RateForm({ schemeId, today }: { schemeId: string; today: string }) {
  const [key, setKey] = useState(0);
  const [state, action, pending] = useSettingsAction(addRate, "New rate saved", () => setKey((k) => k + 1));
  return (
    <form key={key} onSubmit={submitKeepingValues(action)} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="schemeId" value={schemeId} />
      <div className="space-y-1.5"><Label htmlFor={`r-${schemeId}`}>New rate %</Label><Input id={`r-${schemeId}`} name="rate" inputMode="decimal" placeholder="7.5" className="w-24" /></div>
      <div className="space-y-1.5"><Label htmlFor={`f-${schemeId}`}>From</Label><Input id={`f-${schemeId}`} name="effectiveFrom" type="date" defaultValue={today} className="w-36" /></div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>{pending ? "Saving…" : "Change rate"}</Button>
      <div className="w-full"><FormError state={state} /></div>
    </form>
  );
}

export function SchemeEditToggle({ productId, scheme }: { productId: string; scheme: { id: string; name: string; tenureMonths: number | null; active: boolean } }) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>Edit</Button>;
  return (
    <div className="space-y-1">
      <EditSchemeForm productId={productId} scheme={scheme} onDone={() => setOpen(false)} />
      <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
    </div>
  );
}

export function AddCustomFieldForm({ productId }: { productId: string }) {
  const [key, setKey] = useState(0);
  const [type, setType] = useState<CustomFieldType>("Text");
  const [state, action, pending] = useSettingsAction(addCustomField, "Field added", () => { setKey((k) => k + 1); setType("Text"); });
  return (
    <form key={key} onSubmit={submitKeepingValues(action)} className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3">
      <input type="hidden" name="productId" value={productId} />
      <div className="space-y-1.5"><Label htmlFor="cf-label">Custom field</Label><Input id="cf-label" name="label" placeholder="Post office branch" className="w-44" /></div>
      <div className="space-y-1.5">
        <Label htmlFor="cf-type">Type</Label>
        <NativeSelect id="cf-type" name="type" value={type} onChange={(e) => setType(e.target.value as CustomFieldType)}>
          {Object.entries(CUSTOM_FIELD_TYPE_LABEL).map(([k, l]) => <NativeSelectOption key={k} value={k}>{l}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      {type === "Dropdown" && <div className="space-y-1.5"><Label htmlFor="cf-options">Values (comma separated)</Label><Input id="cf-options" name="options" placeholder="Yearly, To bank" className="w-52" /></div>}
      <div className="pb-1.5"><Check name="required" label="Required" /></div>
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Adding…" : "+ Add custom field"}</Button>
      <div className="w-full"><FormError state={state} /></div>
    </form>
  );
}

export function RemoveFieldButton({ fieldId, label }: { fieldId: string; label: string }) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  if (!confirm) return <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirm(true)}>Remove</Button>;
  return (
    <span className="flex items-center gap-1 text-xs">
      Remove {label}?
      <Button type="button" size="xs" variant="destructive" disabled={pending} onClick={() => start(async () => {
        const r = await removeCustomField(fieldId);
        if (r.ok) toast.success(`${label} removed`); else toast.error(r.error);
        setConfirm(false);
      })}>Yes</Button>
      <Button type="button" size="xs" variant="ghost" onClick={() => setConfirm(false)}>No</Button>
    </span>
  );
}
