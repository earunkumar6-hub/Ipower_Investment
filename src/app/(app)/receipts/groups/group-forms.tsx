"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { submitKeepingValues } from "@/lib/form";
import { addBillGroupMember, addBillGroupMembers, createBillGroup, findPoliciesForGroup, type GroupPolicyHit, removeBillGroupMember } from "../group-actions";

/** Admin / Super Admin: find a customer's policies by name, Customer ID, mobile or policy no., tick and add them. */
export function FindPoliciesToAdd({ billGroupId }: { billGroupId: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GroupPolicyHit[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();

  function search(text = q) {
    startSearch(async () => {
      const r = await findPoliciesForGroup(billGroupId, text);
      setPicked(new Set());
      if ("error" in r) {
        setError(r.error);
        setHits(null);
        return;
      }
      setError("");
      setHits(r.hits);
      setMore(r.more);
    });
  }

  function add() {
    startAdd(async () => {
      const r = await addBillGroupMembers(billGroupId, [...picked]);
      if (!r.ok) return void setError(r.error ?? "Could not add");
      toast.success(r.message ?? "Added to the group");
      search(); // refresh: the added ones now show "Already in this group"
    });
  }

  const toggle = (id: string, on: boolean) => setPicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="flex items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="bg-find" className="text-xs">Find policies to add</Label>
          <Input id="bg-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer name, Customer ID, mobile or policy no." className="h-8 w-96" />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={searching}>{searching ? "Searching…" : "Search"}</Button>
      </form>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {hits && (hits.length === 0 ? <p className="text-sm text-muted-foreground">No active policies match.</p> : (
        <>
          <Table>
            <TableHeader>
              <TableRow><TableHead className="w-8" /><TableHead>Customer</TableHead><TableHead>Policy / account</TableHead><TableHead>Product</TableHead><TableHead>Pay mode</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {hits.map((h) => (
                <TableRow key={h.id} className={h.problem ? "text-muted-foreground" : undefined}>
                  <TableCell>
                    <input type="checkbox" aria-label={`Add ${h.policyNumber}`} disabled={!!h.problem} checked={picked.has(h.id)} onChange={(e) => toggle(h.id, e.target.checked)} />
                  </TableCell>
                  <TableCell>{h.customer}<span className="block text-xs text-muted-foreground">{h.cifNo}</span></TableCell>
                  <TableCell>{h.policyNumber}</TableCell>
                  <TableCell className="whitespace-normal">{h.product}</TableCell>
                  <TableCell>{h.payMode}</TableCell>
                  <TableCell className="text-xs">{h.problem}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {more && <p className="text-xs text-muted-foreground">Showing the first 40; type more to narrow it down.</p>}
          <Button type="button" size="sm" disabled={adding || picked.size === 0} onClick={add} className="bg-brand-600 hover:bg-brand-700">
            {adding ? "Adding…" : `Add selected${picked.size ? ` (${picked.size})` : ""}`}
          </Button>
        </>
      ))}
    </div>
  );
}

/** Admin / Super Admin: a new bill group (name, and who usually pays). */
export function CreateBillGroupForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await createBillGroup(prev, form);
    if (r.ok) {
      toast.success("Bill group created");
      router.push(r.href!);
    }
    return r;
  }, { ok: false });
  const err = state.fieldErrors ?? {};
  return (
    <form onSubmit={submitKeepingValues(action)} className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">New bill group</h2>
      <div className="space-y-1.5"><Label htmlFor="bg-name">Group name</Label><Input id="bg-name" name="name" placeholder="e.g. Ramesh family" aria-invalid={!!err.name} /></div>
      <div className="space-y-1.5"><Label htmlFor="bg-contact">Usually paid by (optional)</Label><Input id="bg-contact" name="contactName" /></div>
      <div className="space-y-1.5"><Label htmlFor="bg-mobile">Payer&apos;s mobile (optional)</Label><Input id="bg-mobile" name="contactMobile" inputMode="numeric" maxLength={10} aria-invalid={!!err.contactMobile} /></div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Creating…" : "Create bill group"}</Button>
    </form>
  );
}

/** Admin / Super Admin: add a policy / account by its number. */
export function AddMemberForm({ billGroupId }: { billGroupId: string }) {
  const [key, setKey] = useState(0);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await addBillGroupMember(prev, form);
    if (r.ok) {
      toast.success("Added to the group");
      setKey((k) => k + 1);
    }
    return r;
  }, { ok: false });
  return (
    <form key={key} onSubmit={submitKeepingValues(action)} className="flex items-end gap-2">
      <input type="hidden" name="billGroupId" value={billGroupId} />
      <div className="space-y-1"><Label htmlFor="bg-policy" className="text-xs">Policy / account no.</Label><Input id="bg-policy" name="policyNumber" className="h-8 w-56" aria-invalid={!!state.fieldErrors?.policyNumber} /></div>
      <Button type="submit" size="sm" disabled={pending} className="bg-brand-600 hover:bg-brand-700">{pending ? "Adding…" : "Add policy to group"}</Button>
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}

export function RemoveMemberButton({ memberId, policyNumber }: { memberId: string; policyNumber: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await removeBillGroupMember(prev, form);
    if (r.ok) toast.success(`${policyNumber} removed`);
    return r;
  }, { ok: false });
  return (
    <form action={action}>
      <input type="hidden" name="memberId" value={memberId} />
      <Button type="submit" size="xs" variant="ghost" disabled={pending} aria-label={`Remove ${policyNumber}`}>{pending ? "Removing…" : "Remove"}</Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}
