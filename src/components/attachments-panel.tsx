"use client";

import type { AttachmentOwner } from "@prisma/client";
import { PaperclipIcon } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { removeAttachment, uploadAttachment } from "@/app/(app)/attachments/actions";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { submitKeepingValues } from "@/lib/form";

export type AttachmentRow = { id: string; kind: string; fileName: string; size: number; added: string; by: string; canRemove: boolean };

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** File list with "Attach file"; used on quotations, proposals and customers. */
export function AttachmentsPanel({ ownerType, ownerId, kinds, files, readOnly }: { ownerType: AttachmentOwner; ownerId: string; kinds: string[]; files: AttachmentRow[]; readOnly?: boolean }) {
  const [key, setKey] = useState(0);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await uploadAttachment(prev, form);
    if (r.ok) {
      toast.success("File attached");
      setKey((k) => k + 1);
    }
    return r;
  }, { ok: false });

  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <tbody>
          {files.map((f) => (
            <tr key={f.id} className="border-b last:border-0">
              <td className="py-1.5 pr-2">
                <a href={`/api/attachments/${f.id}`} target="_blank" rel="noopener" className="text-brand-700 hover:underline">{f.fileName}</a>
                <div className="text-xs text-muted-foreground">{f.kind} · {kb(f.size)} · {f.added} · {f.by}</div>
              </td>
              <td className="py-1.5 text-right">{f.canRemove && !readOnly && <RemoveButton id={f.id} name={f.fileName} />}</td>
            </tr>
          ))}
          {files.length === 0 && <tr><td className="py-2 text-muted-foreground">No files yet.</td></tr>}
        </tbody>
      </table>
      {!readOnly && (
        <form key={key} onSubmit={submitKeepingValues(action)} className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2">
          <input type="hidden" name="ownerType" value={ownerType} />
          <input type="hidden" name="ownerId" value={ownerId} />
          <NativeSelect name="kind" defaultValue="" aria-label="What is the file" size="sm">
            <NativeSelectOption value="">What is it?</NativeSelectOption>
            {kinds.map((k) => <NativeSelectOption key={k} value={k}>{k}</NativeSelectOption>)}
          </NativeSelect>
          <Input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.webp" aria-label="File" className="h-7 max-w-56 text-xs" />
          <Button type="submit" size="sm" variant="outline" disabled={pending}><PaperclipIcon />{pending ? "Uploading…" : "Attach file"}</Button>
          {state.error && <p className="w-full text-xs text-destructive">{state.error}</p>}
        </form>
      )}
    </div>
  );
}

function RemoveButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  if (!confirm) return <Button type="button" size="xs" variant="ghost" className="text-destructive" onClick={() => setConfirm(true)}>Remove</Button>;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      Remove?
      <Button type="button" size="xs" variant="destructive" disabled={pending} onClick={() => start(async () => {
        const r = await removeAttachment(id);
        if (r.ok) toast.success(`${name} removed`); else toast.error(r.error);
        setConfirm(false);
      })}>Yes</Button>
      <Button type="button" size="xs" variant="ghost" onClick={() => setConfirm(false)}>No</Button>
    </span>
  );
}
