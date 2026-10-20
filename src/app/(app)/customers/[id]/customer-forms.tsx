"use client";

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useActionState, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { useConfirmBeforeSave } from "@/components/confirm-save";
import { MobilesField } from "@/components/mobiles-field";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MobileEntry } from "@/lib/mobiles";
import { editCustomer } from "../actions";
import { ClosePolicyButton } from "./close-policy-dialog";

type Details = { id: string; name: string; email: string; address: string; mobiles: MobileEntry[] };

/** Correct the customer's name, mobile numbers, email and address (logged). */
export function EditCustomerButton({ customer }: { customer: Details }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await editCustomer(prev, form);
    if (r.ok) {
      toast.success("Customer details saved");
      setOpen(false);
      router.refresh();
    }
    return r;
  }, { ok: false });
  const confirm = useConfirmBeforeSave(action, (form) => {
    const ticked = new Set(form.getAll("whatsApp").map(String));
    return [
      ["Name", String(form.get("name") ?? "")],
      ["Mobile", form.getAll("mobile").map((m, i) => `${String(m).trim()}${ticked.has(String(i)) ? " (WhatsApp)" : ""}`).filter((m) => m.trim()).join(", ")],
      ["Email", String(form.get("email") ?? "")],
      ["Address", String(form.get("address") ?? "")],
    ];
  });
  const err = state.fieldErrors ?? {};
  return (
    <>
      <Button type="button" size="xs" variant="outline" onClick={() => setOpen(true)}>Edit details</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="text-lg font-semibold">Edit customer</DialogTitle>
          <form onSubmit={confirm.onSubmit} className="space-y-3">
            <input type="hidden" name="customerId" value={customer.id} />
            <div className="space-y-1.5"><Label htmlFor="c-name">Name</Label><Input id="c-name" name="name" defaultValue={customer.name} aria-invalid={!!err.name} /></div>
            <MobilesField initial={customer.mobiles.length ? customer.mobiles : [{ number: "", isWhatsApp: true }]} error={err.mobile} />
            <div className="space-y-1.5"><Label htmlFor="c-email">Email</Label><Input id="c-email" name="email" type="email" defaultValue={customer.email} aria-invalid={!!err.email} /></div>
            <div className="space-y-1.5"><Label htmlFor="c-address">Address</Label><Input id="c-address" name="address" defaultValue={customer.address} maxLength={300} /></div>
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save changes"}</Button>
            </div>
          </form>
          {confirm.dialog}
        </DialogContent>
      </Dialog>
    </>
  );
}

export type HoldingRow = {
  id: string; customerId: string; kind: string; plan: string; cover: string | null; policyNumber: string; amount: string; per: string; rate: string; commenced: string;
  tenure: string; lockIn: string; maturity: string; status: [string, Tone]; closedNote: string | null; details: [string, string][];
  close: { label: string; isMf: boolean; today: string; startDate: string; lockInUntil: string | null } | null;
};

/** Products invested: one row per policy/account; "Details" opens nominee, custom fields and masked bank details. */
export function HoldingsTable({ rows }: { rows: HoldingRow[] }) {
  const [open, setOpen] = useState<string[]>([]);
  const toggle = (id: string) => setOpen(open.includes(id) ? open.filter((x) => x !== id) : [...open, id]);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Product</TableHead><TableHead>Scheme / plan</TableHead><TableHead>Policy / account no.</TableHead><TableHead className="text-right">Invested / premium</TableHead>
          <TableHead className="text-right">Rate</TableHead><TableHead>Commenced</TableHead><TableHead>Tenure</TableHead><TableHead>Lock-in until</TableHead><TableHead>Maturity</TableHead>
          <TableHead>Status</TableHead><TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <Fragment key={r.id}>
            <TableRow>
              <TableCell>{r.kind}</TableCell>
              <TableCell className="whitespace-normal">{r.plan}{r.cover && <div className="text-xs text-muted-foreground">cover {r.cover}</div>}</TableCell>
              <TableCell>
                <Link href={`/customers/${r.customerId}/schedule/${r.id}`} className="hover:underline" title="View schedule">{r.policyNumber}</Link>
                {r.details.length > 0 && (
                  <button type="button" onClick={() => toggle(r.id)} className="ml-1 inline-flex items-center text-xs text-brand-700 hover:underline" aria-expanded={open.includes(r.id)}>
                    {open.includes(r.id) ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}Details
                  </button>
                )}
              </TableCell>
              <TableCell className="text-right">{r.amount} <span className="text-xs text-muted-foreground">{r.per}</span></TableCell>
              <TableCell className="text-right">{r.rate}</TableCell>
              <TableCell>{r.commenced}</TableCell>
              <TableCell>{r.tenure}</TableCell>
              <TableCell>{r.lockIn}</TableCell>
              <TableCell>{r.maturity}</TableCell>
              <TableCell>
                <StatusBadge tone={r.status[1]}>{r.status[0]}</StatusBadge>
                {r.closedNote && <div className="text-xs text-muted-foreground">{r.closedNote}</div>}
              </TableCell>
              <TableCell className="text-right">{r.close && <ClosePolicyButton policyId={r.id} {...r.close} />}</TableCell>
            </TableRow>
            {open.includes(r.id) && (
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableCell colSpan={11} className="text-xs whitespace-normal">
                  <dl className="flex flex-wrap gap-x-6 gap-y-1">
                    {r.details.map(([k, v]) => <div key={k}><dt className="inline text-muted-foreground">{k}: </dt><dd className="inline">{v}</dd></div>)}
                  </dl>
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
        {rows.length === 0 && <TableRow><TableCell colSpan={11} className="py-4 text-center text-muted-foreground">No products yet. Use Add product directly or a quotation.</TableCell></TableRow>}
      </TableBody>
    </Table>
  );
}
