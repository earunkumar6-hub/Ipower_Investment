"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { submitKeepingValues } from "@/lib/form";
import { saveAccount, setAccountActive, setDefaultBank } from "../money-actions";

export type BankValues = { id?: string; bankName: string; branch: string; last4: string | null; ifsc: string; micr: string; accountKind: string };
export type WalletValues = { id?: string; walletKind: string; otherName: string; lowBalanceThreshold: string };

function useSave(onDone: () => void, message: string) {
  return useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await saveAccount(prev, form);
    if (r.ok) {
      toast.success(message);
      onDone();
    }
    return r;
  }, { ok: false });
}

const Field = ({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    {children}
    {error && <p className="text-xs text-destructive">{error}</p>}
  </div>
);

export function BankAccountForm({ value }: { value?: BankValues }) {
  const router = useRouter();
  const editing = !!value?.id;
  const [state, action, pending] = useSave(() => router.push("/settings/accounts"), editing ? "Bank account updated" : "Bank account added");
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={submitKeepingValues(action)} className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">{editing ? "Edit bank account" : "Add bank account"}</h2>
      <input type="hidden" name="type" value="Bank" />
      {editing && <input type="hidden" name="id" value={value.id} />}
      <div className="grid grid-cols-2 gap-3">
        <Field id="bankName" label="Bank" error={err.bankName}><Input id="bankName" name="bankName" defaultValue={value?.bankName} placeholder="e.g. SBI" /></Field>
        <Field id="branch" label="Branch" error={err.branch}><Input id="branch" name="branch" defaultValue={value?.branch} /></Field>
        <Field id="accountNo" label={editing ? `Account number (now ••••${value.last4 ?? ""}; blank keeps it)` : "Account number"} error={err.accountNo}>
          <Input id="accountNo" name="accountNo" inputMode="numeric" autoComplete="off" />
        </Field>
        <Field id="accountKind" label="Account type" error={err.accountKind}>
          <NativeSelect id="accountKind" name="accountKind" defaultValue={value?.accountKind ?? ""} className="w-full">
            <NativeSelectOption value=""></NativeSelectOption>
            <NativeSelectOption value="Savings">Savings</NativeSelectOption>
            <NativeSelectOption value="Current">Current</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field id="ifsc" label="IFSC" error={err.ifsc}><Input id="ifsc" name="ifsc" defaultValue={value?.ifsc} className="uppercase" placeholder="SBIN0001234" /></Field>
        <Field id="micr" label="MICR code" error={err.micr}><Input id="micr" name="micr" defaultValue={value?.micr} inputMode="numeric" maxLength={9} placeholder="9 digits" /></Field>
        {!editing && <Field id="openingBalance" label="Opening balance today (₹)" error={err.openingBalance}><Input id="openingBalance" name="openingBalance" inputMode="decimal" placeholder="0" /></Field>}
      </div>
      <p className="text-xs text-muted-foreground">The account number is stored encrypted and shown as ••••1234.{!editing && " The opening balance can't be changed later."}</p>
      {state.error && !Object.keys(err).length && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : editing ? "Save changes" : "Add bank account"}</Button>
        {editing && <Button type="button" variant="ghost" onClick={() => router.push("/settings/accounts")}>Cancel</Button>}
      </div>
    </form>
  );
}

export function WalletForm({ value }: { value?: WalletValues }) {
  const router = useRouter();
  const editing = !!value?.id;
  const [kind, setKind] = useState(value?.walletKind ?? "");
  const [state, action, pending] = useSave(() => router.push("/settings/accounts"), editing ? "Wallet updated" : "Wallet added");
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={submitKeepingValues(action)} className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">{editing ? "Edit wallet" : "Add wallet"}</h2>
      <input type="hidden" name="type" value="Wallet" />
      {editing && <input type="hidden" name="id" value={value.id} />}
      <div className="grid grid-cols-2 gap-3">
        <Field id="walletKind" label="Wallet" error={err.walletKind}>
          <NativeSelect id="walletKind" name="walletKind" value={kind} onChange={(e) => setKind(e.target.value)} className="w-full">
            <NativeSelectOption value=""></NativeSelectOption>
            <NativeSelectOption value="CSC">CSC wallet</NativeSelectOption>
            <NativeSelectOption value="ESevai">E-Sevai wallet</NativeSelectOption>
            <NativeSelectOption value="Other">Other</NativeSelectOption>
          </NativeSelect>
        </Field>
        {kind === "Other" && <Field id="otherName" label="Wallet name" error={err.otherName}><Input id="otherName" name="otherName" defaultValue={value?.otherName} /></Field>}
        <Field id="lowBalanceThreshold" label="Low-balance alert below (₹)" error={err.lowBalanceThreshold}>
          <Input id="lowBalanceThreshold" name="lowBalanceThreshold" inputMode="decimal" defaultValue={value?.lowBalanceThreshold} placeholder="blank for none" />
        </Field>
        {!editing && <Field id="wOpening" label="Opening balance today (₹)" error={err.openingBalance}><Input id="wOpening" name="openingBalance" inputMode="decimal" placeholder="0" /></Field>}
      </div>
      {state.error && !Object.keys(err).length && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : editing ? "Save changes" : "Add wallet"}</Button>
        {editing && <Button type="button" variant="ghost" onClick={() => router.push("/settings/accounts")}>Cancel</Button>}
      </div>
    </form>
  );
}

/** Switch off / on, and "Make default" for bank accounts. */
export function AccountActions({ id, active, canDefault }: { id: string; active: boolean; canDefault: boolean }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, ok: string) => start(async () => {
    const r = await fn();
    if (r.ok) toast.success(ok);
    else toast.error(r.error ?? "Could not save");
  });
  return (
    <div className="flex gap-1">
      {canDefault && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setDefaultBank(id), "Default bank account changed")}>Make default</Button>}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setAccountActive(id, !active), active ? "Switched off" : "Switched on")}>
        {active ? "Switch off" : "Switch on"}
      </Button>
    </div>
  );
}
