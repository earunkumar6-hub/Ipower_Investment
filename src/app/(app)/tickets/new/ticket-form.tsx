"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, startTransition, useActionState, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachment-rules";
import { raiseTicket } from "../actions";

const PRIORITIES = [
  ["High", "High – work is stopped / money is wrong (same day)"],
  ["Medium", "Medium – a problem with a way around it (2 working days)"],
  ["Low", "Low – small issue or idea (7 days)"],
] as const;
const TYPES = [["Problem", "Problem"], ["NewFeature", "New feature"], ["Question", "Question"]] as const;

export function TicketForm({ screens }: { screens: string[] }) {
  const router = useRouter();
  const [clientError, setClientError] = useState<string | null>(null);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await raiseTicket(prev, form);
    if (r.ok) {
      toast.success(r.message ?? "Ticket raised");
      router.push(r.href ?? "/tickets");
    }
    return r;
  }, { ok: false });
  const err = state.fieldErrors ?? {};

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); // keeps the input on an error (React 19 would reset the form)
    const form = new FormData(e.currentTarget);
    const file = form.get("screenshot");
    // The server only accepts uploads up to 6 MB; a bigger file would break the page instead of showing this.
    const problem = file instanceof File && file.size > MAX_ATTACHMENT_BYTES ? "Screenshot must be 5 MB or smaller" : null;
    setClientError(problem);
    if (!problem) startTransition(() => action(form));
  }

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">Raise ticket</h2>
      <Field label="Title" error={err.title}>
        <Input id="title" name="title" maxLength={120} placeholder="e.g. Receipt PDF not opening" aria-invalid={!!err.title} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Screen" error={err.screen}>
          <NativeSelect id="screen" name="screen" defaultValue="" className="w-full" aria-invalid={!!err.screen}>
            <NativeSelectOption value=""></NativeSelectOption>
            {screens.map((s) => <NativeSelectOption key={s} value={s}>{s}</NativeSelectOption>)}
          </NativeSelect>
        </Field>
        <Field label="Type" error={err.type}>
          <NativeSelect id="type" name="type" defaultValue="" className="w-full" aria-invalid={!!err.type}>
            <NativeSelectOption value=""></NativeSelectOption>
            {TYPES.map(([v, l]) => <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}
          </NativeSelect>
        </Field>
        <Field label="Priority" error={err.priority}>
          <NativeSelect id="priority" name="priority" defaultValue="" className="w-full" aria-invalid={!!err.priority}>
            <NativeSelectOption value=""></NativeSelectOption>
            {PRIORITIES.map(([v, l]) => <NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}
          </NativeSelect>
        </Field>
      </div>
      <Field label="Details" error={err.details}>
        <Textarea id="details" name="details" rows={6} maxLength={4000} aria-invalid={!!err.details}
          placeholder="What were you doing, what happened, what did you expect? For a new feature: what should it do and why." />
      </Field>
      <Field label="Screenshot (optional)" error={clientError ?? err.screenshot}>
        <Input id="screenshot" name="screenshot" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="text-xs" />
      </Field>
      {(clientError ?? state.error) && <p className="rounded-lg bg-orange-50 p-2 text-sm text-orange-900">{clientError ?? state.error}</p>}
      <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Raising…" : "Raise ticket"}</Button>
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
