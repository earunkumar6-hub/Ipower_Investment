"use client";

import type { AttachmentOwner } from "@prisma/client";
import { OTHER, OtherOptionSelect } from "@/components/other-option-select";
import { PaperclipIcon } from "lucide-react";
import { type FormEvent, startTransition, useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { removeAttachment, uploadAttachment } from "@/app/(app)/attachments/actions";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ID_COPY_MAX_BYTES, ID_COPY_RULE, isIdCopy, isSmallJpeg, MAX_ATTACHMENT_BYTES } from "@/lib/attachment-rules";

/** A JPG of 50 KB or smaller from any photo: scaled down and re-compressed in the browser. */
async function shrinkToJpeg(file: File): Promise<File | null> {
  const img = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null); // phone photos stay upright
  if (!img) return null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  let scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  for (let i = 0; i < 12; i++, scale *= 0.8) {
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    ctx.fillStyle = "#fff"; // transparent PNG areas become white, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.65, 0.5]) {
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", quality));
      if (blob && blob.size <= ID_COPY_MAX_BYTES) return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
    }
  }
  return null;
}

/** Checks the file before it is sent: Aadhaar / PAN photos are shrunk to a small JPG; other files over 5 MB stop here. */
async function prepareUpload(form: FormData): Promise<string | null> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return null; // the server says "Choose a file"
  const kind = form.get("kind") === OTHER ? String(form.get("kindOther") ?? "") : String(form.get("kind") ?? "");
  if (isIdCopy(kind)) {
    if (isSmallJpeg(file)) return null;
    const small = file.type.startsWith("image/") ? await shrinkToJpeg(file) : null;
    if (!small) return ID_COPY_RULE;
    form.set("file", small);
    return null;
  }
  // The server only accepts uploads up to 6 MB; a bigger file would break the page instead of showing this.
  if (file.size > MAX_ATTACHMENT_BYTES) return "File must be 5 MB or smaller";
  return null;
}

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
  const [clientError, setClientError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); // also keeps the input on an error (React 19 would reset the form)
    const form = new FormData(e.currentTarget);
    setPreparing(true);
    const problem = await prepareUpload(form);
    setPreparing(false);
    setClientError(problem);
    if (!problem) startTransition(() => action(form));
  }

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
        <form key={key} onSubmit={onSubmit} className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2">
          <input type="hidden" name="ownerType" value={ownerType} />
          <input type="hidden" name="ownerId" value={ownerId} />
          <OtherOptionSelect name="kind" options={kinds} placeholder="What is it?" label="What is the file" size="sm" className="w-44" />
          <Input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.webp" aria-label="File" className="h-7 max-w-56 text-xs" />
          <Button type="submit" size="sm" variant="outline" disabled={pending || preparing}><PaperclipIcon />{preparing ? "Preparing…" : pending ? "Uploading…" : "Attach file"}</Button>
          {(clientError ?? state.error) && <p className="w-full text-xs text-destructive">{clientError ?? state.error}</p>}
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
