"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { acceptQuotation, createProposal } from "../actions";

export function AcceptButton({ quotationId, disabled }: { quotationId: string; disabled?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={disabled || pending} onClick={() => start(async () => {
      const r = await acceptQuotation(quotationId);
      if (r.ok) toast.success("Marked accepted");
      else toast.error(r.error);
    })}>
      {pending ? "Saving…" : "Mark accepted"}
    </Button>
  );
}

export function CreateProposalButton({ quotationItemId }: { quotationItemId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" className="bg-brand-600 hover:bg-brand-700" disabled={pending} onClick={() => start(async () => {
      const r = await createProposal(quotationItemId); // redirects to the proposal on success
      if (!r.ok) toast.error(r.error);
    })}>
      {pending ? "Creating…" : "Create proposal"}
    </Button>
  );
}
