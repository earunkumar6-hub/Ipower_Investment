"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { markMatured, sendRenewalReminder } from "./actions";

export function MaturityRowActions({ policyId }: { policyId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
      const r = await markMatured(policyId);
      if (r.ok) toast.success("Marked as matured");
      else toast.error(r.error);
    })}>Mark matured</Button>
  );
}

export function RenewalRowActions({ renewalItemId, customerId }: { renewalItemId: string; customerId: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
        const r = await sendRenewalReminder(renewalItemId);
        if (r.ok) toast.success("Reminder logged in Sent messages (mock WhatsApp)");
        else toast.error(r.error);
      })}>Send reminder</Button>
      <Link href={`/receipts/new?customerId=${customerId}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>Take payment</Link>
    </div>
  );
}
