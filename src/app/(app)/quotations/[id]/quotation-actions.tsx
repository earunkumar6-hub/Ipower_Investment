"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createProposalsFromSelected, deleteQuotation, markNotAccepted, markQuotationSent } from "../actions";

export type QuoteItemRow = {
  id: string; category: string; plan: string; cover: string; payMode: string; premium: string;
  decision: "Pending" | "Selected" | "NotAccepted"; proposal: { id: string; no: string } | null;
};

/** Quoted products with a "Selected" tick each; the ticked ones become proposals. */
/** `mf`: how many rows are mutual funds – "all" swaps to SIP / Lumpsum / Investment amount wording. `showCover`: false when no row has cover to show (mutual funds, RD / TD / KVP / NSC / SCSS / MIS only). */
/** `amountLabel`: header of the money column (Premium / Investment amount / Amount, or "Premium / amount" when mixed). */
export function QuoteItemsTable({ quotationId, items, total, canDecide, mf = "none", showCover = true, amountLabel }: { quotationId: string; items: QuoteItemRow[]; total: string; canDecide: boolean; mf?: "all" | "some" | "none"; showCover?: boolean; amountLabel?: string }) {
  const open = items.filter((i) => !i.proposal);
  const [ticked, setTicked] = useState<string[]>(() => open.filter((i) => i.decision !== "NotAccepted").map((i) => i.id));
  const [pending, start] = useTransition();
  const toggle = (id: string, on: boolean) => setTicked(on ? [...ticked, id] : ticked.filter((x) => x !== id));

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            {canDecide && <TableHead className="w-20">Selected</TableHead>}
            <TableHead>Product</TableHead><TableHead>Partner · plan</TableHead>{showCover && <TableHead className="text-right">Cover</TableHead>}<TableHead>{mf === "all" ? "SIP / Lumpsum" : "Pay mode"}</TableHead>
            <TableHead className="text-right">{amountLabel ?? (mf === "all" ? "Investment amount" : mf === "some" ? "Premium / amount" : "Premium")}</TableHead><TableHead>Proposal</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((i) => (
            <TableRow key={i.id}>
              {canDecide && (
                <TableCell>
                  {!i.proposal && <input type="checkbox" aria-label={`Select ${i.plan}`} checked={ticked.includes(i.id)} onChange={(e) => toggle(i.id, e.target.checked)} className="size-4 accent-brand-600" />}
                </TableCell>
              )}
              <TableCell>{i.category}</TableCell>
              <TableCell className="whitespace-normal">{i.plan}</TableCell>
              {showCover && <TableCell className="text-right">{i.cover}</TableCell>}
              <TableCell>{i.payMode}</TableCell>
              <TableCell className="text-right font-medium">{i.premium}</TableCell>
              <TableCell>
                {i.proposal ? <Link href={`/proposals/${i.proposal.id}`} className="text-brand-700 hover:underline">{i.proposal.no}</Link>
                  : i.decision === "NotAccepted" ? <StatusBadge tone="orange">Not accepted</StatusBadge> : <span className="text-muted-foreground">—</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={(canDecide ? 5 : 4) - (showCover ? 0 : 1)} className="text-right">{mf === "all" ? "Total investment" : "Total payable"}</TableCell>
            <TableCell className="text-right font-semibold">{total}</TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
      {canDecide && open.length > 0 && (
        <Button disabled={pending || ticked.length === 0} className="bg-brand-600 hover:bg-brand-700" onClick={() => start(async () => {
          const r = await createProposalsFromSelected(quotationId, ticked);
          if (r.ok) toast.success(r.message ?? "Proposals created"); else toast.error(r.error);
        })}>
          {pending ? "Creating…" : `Create proposal from selected (${ticked.length})`}
        </Button>
      )}
    </div>
  );
}

/** "Mark not accepted" and "Delete quotation", each asking for a reason. */
/** "Mark as sent" (#35): Drafts → Sent. */
export function MarkSentButton({ quotationId }: { quotationId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant="outline" disabled={pending} onClick={() => start(async () => {
      const r = await markQuotationSent(quotationId);
      if (r.ok) toast.success("Marked as sent"); else toast.error(r.error ?? "Could not save");
    })}>{pending ? "Saving…" : "Mark as sent"}</Button>
  );
}

export function ReasonButton({ quotationId, kind }: { quotationId: string; kind: "notAccepted" | "delete" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const del = kind === "delete";
  const run = () => start(async () => {
    const r: ActionResult = await (del ? deleteQuotation : markNotAccepted)(quotationId, reason);
    if (!r.ok) return setError(r.error ?? "Could not save");
    toast.success(del ? "Quotation deleted" : "Marked not accepted");
    setOpen(false);
    if (r.href) router.push(r.href);
  });
  return (
    <>
      <Button type="button" variant={del ? "destructive" : "outline"} onClick={() => setOpen(true)}>{del && <TriangleAlert />}{del ? "Delete quotation" : "Mark not accepted"}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle className="text-lg font-semibold">{del ? "Delete quotation" : "Customer did not accept"}</DialogTitle>
          <div className="space-y-1.5">
            <Label htmlFor={`reason-${kind}`}>Reason</Label>
            <Input id={`reason-${kind}`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground">{del ? "Allowed only while no proposal has been made. The quotation is hidden but kept in the change log." : "All products are marked not accepted."}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Back</Button>
            <Button type="button" disabled={pending} variant={del ? "destructive" : "default"} onClick={run}>{pending ? "Saving…" : del ? "Delete" : "Mark not accepted"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
