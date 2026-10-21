"use client";

import { MessageCircleIcon } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { shareOnWhatsApp } from "./actions";

/** Mocked like all messages: the share is written to Sent messages. */
export function ShareButton({ kind, id }: { kind: "Receipt" | "Payment" | "DirectBill"; id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant="outline" disabled={pending} onClick={() => start(async () => {
      const r = await shareOnWhatsApp(kind, id);
      if (r.ok) toast.success("Shared on WhatsApp (demo: see Sent messages)");
      else toast.error(r.error ?? "Could not share");
    })}>
      <MessageCircleIcon className="size-4" />{pending ? "Sharing…" : "Share on WhatsApp"}
    </Button>
  );
}
