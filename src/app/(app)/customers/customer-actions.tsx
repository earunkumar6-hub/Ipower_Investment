"use client";

import { Menu } from "@base-ui/react/menu";
import { CalendarPlus, ChevronDown, Eye, FilePlus2, FileText, Pencil, Receipt, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddFollowUpForm } from "./[id]/profile-forms";
import { deleteCustomer } from "./actions";

const ITEM = "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none data-highlighted:bg-saffron-50 data-highlighted:text-brand-800";

/**
 * Action menu on a Customers row (owner, 4 Nov 2026): view, edit details, add product, new receipt, new quotation,
 * add follow-up, delete. Items follow the user's permissions; Delete only for a customer with no records.
 */
export function CustomerActions({ customer, can, inUse, today }: {
  customer: { id: string; name: string; cifNo: string };
  can: { edit: boolean; receipt: boolean; quote: boolean; delete: boolean };
  /** Why the customer can't be deleted ("Has 2 products – can't be deleted"), or null. */
  inUse: string | null;
  today: string;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"followup" | "delete" | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const href = `/customers/${customer.id}`;

  const remove = () => start(async () => {
    const r = await deleteCustomer(customer.id, typed);
    if (!r.ok) return setError(r.error ?? "Not deleted");
    toast.success(r.message ?? "Customer deleted");
    setDialog(null);
    router.refresh();
  });

  return (
    <>
      <Menu.Root>
        <Menu.Trigger className={buttonVariants({ variant: "outline", size: "xs" })} aria-label={`Actions for ${customer.name}`}>
          Action<ChevronDown className="transition-transform group-data-popup-open/button:rotate-180" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={6} className="z-50">
            <Menu.Popup className="min-w-52 rounded-xl border bg-white p-1.5 shadow-lg shadow-brand-900/10 outline-none">
              <Menu.LinkItem href={href} closeOnClick className={ITEM}><Eye className="size-4" />View customer</Menu.LinkItem>
              {can.edit && <Menu.LinkItem href={`${href}?edit=1`} closeOnClick className={ITEM}><Pencil className="size-4" />Edit details</Menu.LinkItem>}
              {can.edit && <Menu.LinkItem href={`${href}/add-product`} closeOnClick className={ITEM}><FilePlus2 className="size-4" />Add product</Menu.LinkItem>}
              {can.receipt && <Menu.LinkItem href={`/receipts/new?customerId=${customer.id}`} closeOnClick className={ITEM}><Receipt className="size-4" />New receipt</Menu.LinkItem>}
              {can.quote && <Menu.LinkItem href={`/quotations/new?customerId=${customer.id}`} closeOnClick className={ITEM}><FileText className="size-4" />New quotation</Menu.LinkItem>}
              <Menu.Item onClick={() => setDialog("followup")} className={ITEM}><CalendarPlus className="size-4" />Add follow-up</Menu.Item>
              {can.delete && (
                <>
                  <Menu.Separator className="my-1 h-px bg-border" />
                  {inUse
                    ? <div className="flex items-start gap-2 px-2.5 py-1.5 text-sm text-muted-foreground"><Trash2 className="mt-0.5 size-4 shrink-0" /><span>Delete<span className="block text-xs">{inUse}</span></span></div>
                    : <Menu.Item onClick={() => { setTyped(""); setError(""); setDialog("delete"); }} className={`${ITEM} text-destructive`}><Trash2 className="size-4" />Delete customer</Menu.Item>}
                </>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <Dialog open={dialog === "followup"} onOpenChange={(o) => setDialog(o ? "followup" : null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogTitle className="text-lg font-semibold">Add follow-up · {customer.name}</DialogTitle>
          <AddFollowUpForm customerId={customer.id} today={today} onDone={() => setDialog(null)} />
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "delete"} onOpenChange={(o) => setDialog(o ? "delete" : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="text-lg font-semibold">Delete {customer.name}?</DialogTitle>
          <p className="text-sm">
            {customer.cifNo} has no products, proposals, quotations, receipts or bills. Their follow-ups, mobile numbers, photo and
            attached files are deleted too. This can&apos;t be undone.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor={`del-${customer.id}`}>Type DELETE to confirm</Label>
            <Input id={`del-${customer.id}`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="destructive" disabled={pending || typed.trim() !== "DELETE"} onClick={remove}>{pending ? "Deleting…" : "Delete customer"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
