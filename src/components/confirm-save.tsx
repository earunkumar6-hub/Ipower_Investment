"use client";

import { startTransition, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export type SummaryRow = [label: string, value: string];

/**
 * "Check before saving": the form's submit shows what was entered; "Yes, save" sends it, "Go back and edit"
 * returns to the form with every value kept. `summarize` turns the form into label/value rows.
 */
export function useConfirmBeforeSave(action: (form: FormData) => void, summarize: (form: FormData) => SummaryRow[]) {
  const [pending, setPending] = useState<{ form: FormData; rows: SummaryRow[] } | null>(null);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending({ form, rows: summarize(form).filter(([, v]) => v.trim() !== "") });
  };

  const save = () => {
    if (!pending) return;
    const form = pending.form;
    setPending(null);
    startTransition(() => action(form));
  };

  const dialog = (
    <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle className="text-lg font-semibold">Check before saving</DialogTitle>
        <DialogDescription>Please confirm these details are correct.</DialogDescription>
        <table className="w-full text-sm">
          <tbody>
            {pending?.rows.map(([label, value]) => (
              <tr key={label} className="border-b last:border-0">
                <td className="py-1.5 pr-3 align-top text-muted-foreground">{label}</td>
                <td className="py-1.5 font-medium whitespace-pre-line">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setPending(null)}>Go back and edit</Button>
          <Button type="button" onClick={save} className="bg-brand-600 hover:bg-brand-700">Yes, save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { onSubmit, dialog };
}
