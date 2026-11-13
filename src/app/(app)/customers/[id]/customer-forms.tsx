"use client";

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useActionState, useCallback, useEffect, useRef, useState } from "react";
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
import { editCustomer, startEditing, stopEditing, takeOverEditing, type EditingState } from "../actions";
import { customerVersion } from "@/lib/customer-version";
import { ClosePolicyButton } from "./close-policy-dialog";
import { PolicyManageButton } from "./policy-manage";

type Details = { id: string; name: string; email: string; address: string; mobiles: MobileEntry[] };

/** Correct the customer's name, mobile numbers, email and address (logged). */
/** `startOpen`: opened from the Customers list "Action → Edit details" (?edit=1). */
export function EditCustomerButton({ customer, startOpen = false }: { customer: Details; startOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  // "Someone is editing" ticket (QA D-02): null = still asking, ok = ours, else who has it.
  const [editing, setEditing] = useState<EditingState | null>(null);
  const mine = useRef(false);
  const alive = useRef(false); // false once the box has closed: a ticket that arrives late is handed straight back
  // The box opens with the customer as saved NOW (someone may have saved since this page loaded), not with the page's copy.
  const [fresh, setFresh] = useState<Details | null>(null);
  const current = fresh ?? customer;
  const ask = useCallback(async (first = false) => {
    const r = await startEditing(customer.id);
    if (!alive.current) { if (r.ok) void stopEditing(customer.id); return; } // opened and cancelled before the answer came
    mine.current = r.ok;
    if (r.ok && first) setFresh(r.details);
    setEditing(r);
  }, [customer.id]);
  // Take the ticket when the box opens, renew it every minute, give it back when the box closes.
  useEffect(() => {
    if (!open) return;
    alive.current = true;
    void ask(true);
    const timer = setInterval(() => void ask(), 60_000);
    // Tab closed or page left with the box open: give the ticket back at once.
    const leave = () => { if (mine.current) navigator.sendBeacon(`/api/customers/${customer.id}/stop-editing`); };
    window.addEventListener("pagehide", leave);
    return () => {
      alive.current = false;
      clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      if (mine.current) { mine.current = false; void stopEditing(customer.id); }
      setEditing(null);
      setFresh(null);
    };
  }, [open, ask, customer.id]);
  const blocked = !!editing && !editing.ok;
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await editCustomer(prev, form);
    if (r.ok) {
      mine.current = false; // the save released the ticket
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
          <form key={customerVersion(current)} onSubmit={confirm.onSubmit} className="space-y-3">
            <input type="hidden" name="customerId" value={customer.id} />
            {blocked && (
              <div role="alert" className="space-y-2 rounded-lg border border-saffron-300 bg-saffron-50 p-3 text-sm text-saffron-900">
                <p>{editing.error}</p>
                {editing.canTakeOver && (
                  <Button type="button" size="xs" variant="outline" onClick={async () => { const r = await takeOverEditing(customer.id); if (r.ok) await ask(); else toast.error(r.error); }}>
                    Take over editing
                  </Button>
                )}
              </div>
            )}
            {/* The details this form was opened with: a save after someone else changed them is refused (D-02). */}
            <input type="hidden" name="version" value={customerVersion(current)} />
            {/* One Save, at the bottom (owner, 13 Nov 2026: the top one in this pop-up removed). */}
            <fieldset disabled={blocked} className="space-y-3 border-0 p-0">
            <div className="space-y-1.5"><Label htmlFor="c-name">Name</Label><Input id="c-name" name="name" defaultValue={current.name} aria-invalid={!!err.name} /></div>
            <MobilesField initial={current.mobiles.length ? current.mobiles : [{ number: "", isWhatsApp: true }]} error={err.mobile} />
            <div className="space-y-1.5"><Label htmlFor="c-email">Email</Label><Input id="c-email" name="email" type="email" defaultValue={current.email} aria-invalid={!!err.email} /></div>
            <div className="space-y-1.5"><Label htmlFor="c-address">Address</Label><Input id="c-address" name="address" defaultValue={current.address} maxLength={300} /></div>
            </fieldset>
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending || blocked || editing === null} className="bg-brand-600 hover:bg-brand-700">{pending ? "Saving…" : "Save changes"}</Button>
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
  /** Deactivate / switch back on / delete (#25): offered on active and deactivated products. */
  manage: { label: string; deactivated: boolean } | null;
  /** Premature closure button: hidden ("Not allowed"), greyed out during the lock-in, or active. */
  close: { state: "hidden" | "locked"; text: string } | { state: "active"; label: string; isMf: boolean; today: string; startDate: string; lockInUntil: string | null } | null;
};

/** Products invested: one row per policy/account; "Details" opens nominee, custom fields and masked bank details. */
export function HoldingsTable({ rows, canDeactivate, canDelete }: { rows: HoldingRow[]; canDeactivate: boolean; canDelete: boolean }) {
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
              <TableCell className="text-right">
                {r.close?.state === "active" && <ClosePolicyButton policyId={r.id} {...r.close} />}
                {r.close?.state === "locked" && <Button type="button" size="xs" variant="outline" disabled title={r.close.text}>Close early</Button>}
                {r.close && r.close.state !== "active" && <div className="text-xs text-muted-foreground">{r.close.text}</div>}
                {r.manage && <PolicyManageButton policyId={r.id} label={r.manage.label} deactivated={r.manage.deactivated} canDeactivate={canDeactivate} canDelete={canDelete} />}
              </TableCell>
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
