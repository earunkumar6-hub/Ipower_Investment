"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { DmyDateInput } from "@/components/dmy-date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CashDenominationGrid, paise } from "@/components/cash-denomination-grid";
import { OtherOptionSelect } from "@/components/other-option-select";
import { submitKeepingValues } from "@/lib/form";
import { createExpense } from "./actions";

const inr = (n: number) => n.toLocaleString("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 });

function routingHint(amount: string) {
  const n = Number(amount);
  if (!amount || !Number.isFinite(n) || n <= 0) return null;
  if (n <= 2000) return `${inr(n)} is within ₹2,000 – saved without approval.`;
  if (n <= 5000) return `${inr(n)} needs Admin approval (₹2,001–₹5,000).`;
  return `${inr(n)} needs Super Admin approval (above ₹5,000).`;
}

export function ExpenseForm({ categories, accounts, today, userName }: { categories: string[]; accounts: { id: string; label: string; cash: boolean }[]; today: string; userName: string }) {
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState<"Company" | "Employee" | "Owner">("Company");
  const [fromAccount, setFromAccount] = useState(accounts[0]?.id ?? "");
  const fromCash = paidBy === "Company" && !!accounts.find((a) => a.id === fromAccount)?.cash;
  const [formKey, setFormKey] = useState(0);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await createExpense(prev, form);
    if (r.ok) {
      toast.success("Expense saved");
      setAmount("");
      setPaidBy("Company");
      setFromAccount(accounts[0]?.id ?? "");
      setFormKey((k) => k + 1);
    }
    return r;
  }, { ok: false });
  const err = state.fieldErrors ?? {};
  const hint = routingHint(amount);

  return (
    <form key={formKey} onSubmit={submitKeepingValues(action)} className="min-w-0 flex-1 space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">Add expense</h2>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Purpose" error={err.category}>
          <OtherOptionSelect name="category" id="category" options={categories} defaultValue={categories[0]} label="Purpose" error={err.category} />
        </Field>
        <Field label="Description" error={err.description}>
          <Input id="description" name="description" placeholder="Printer paper, pens" aria-invalid={!!err.description} />
        </Field>
        <Field label="Amount" error={err.amount}>
          <Input id="amount" name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="3200" aria-invalid={!!err.amount} />
        </Field>
        <Field label="Vendor" error={err.vendor}>
          <Input id="vendor" name="vendor" placeholder="Sri Stationers" aria-invalid={!!err.vendor} />
        </Field>
        <Field label="Bill number" error={err.billNo}>
          <Input id="billNo" name="billNo" placeholder="B-1045" className="not-placeholder-shown:uppercase" aria-invalid={!!err.billNo} />
        </Field>
        <Field label="Date" error={err.expenseDate}>
          <DmyDateInput name="expenseDate" defaultValue={today} max={today} />
        </Field>
        <Field label="Paid by">
          <NativeSelect id="paidBy" name="paidBy" value={paidBy} onChange={(e) => setPaidBy(e.target.value as typeof paidBy)} className="w-full">
            <NativeSelectOption value="Company">Company account</NativeSelectOption>
            <NativeSelectOption value="Employee">Employee (own money)</NativeSelectOption>
            <NativeSelectOption value="Owner">Owner (personal money)</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field label="Mode">
          <NativeSelect id="mode" name="mode" className="w-full" defaultValue="Cash">
            {["Cash", "UPI", "Bank", "Card", "Cheque"].map((m) => <NativeSelectOption key={m} value={m}>{m === "Bank" ? "Net banking" : m}</NativeSelectOption>)}
          </NativeSelect>
        </Field>
        {paidBy === "Company" ? (
          <Field label="From account" error={err.fromAccount}>
            <NativeSelect id="fromAccount" name="fromAccount" className="w-full" value={fromAccount} onChange={(e) => setFromAccount(e.target.value)}>
              {accounts.map((a) => <NativeSelectOption key={a.id} value={a.id}>{a.label}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
        ) : (
          <>
            <input type="hidden" name="fromAccount" value="" />
            <Field label={paidBy === "Employee" ? "Employee name" : "Owner"} error={err.paidByName}>
              <Input id="paidByName" name="paidByName" defaultValue={paidBy === "Employee" ? userName : "Owner"} readOnly={paidBy === "Owner"} />
            </Field>
          </>
        )}
        <Field label="Bill photo or PDF (optional)" error={err.bill}>
          <Input id="bill" name="bill" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="text-xs" />
        </Field>
        {fromCash && (
          <div className="col-span-3">
            <CashDenominationGrid amount={paise(amount)} error={err.denominations} />
          </div>
        )}
        <div className="col-span-3">
          <Field label="Notes (required)" error={err.notes}>
            <Input id="notes" name="notes" required placeholder="Why it was needed, who asked for it…" aria-invalid={!!err.notes} />
          </Field>
        </div>
      </div>
      {state.error && <p className="rounded-lg bg-orange-50 p-2 text-sm text-orange-900">{state.error}</p>}
      {hint && <p className="rounded-lg bg-saffron-50 p-2 text-sm text-saffron-900">{hint}{paidBy !== "Company" && " Stays “to be repaid” until the company pays it back."}</p>}
      <Button type="submit" disabled={pending} className="w-full bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Submit"}</Button>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && error.length < 60 && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
