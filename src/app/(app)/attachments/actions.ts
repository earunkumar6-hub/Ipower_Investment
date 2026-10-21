"use server";

import { AttachmentOwner } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { attachmentOwner, deleteStoredFile, fileProblem, storeFile } from "@/lib/attachments";
import { ATTACHMENT_LIST, resolveDropdown } from "@/lib/dropdowns";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { seesAll } from "@/lib/permissions";
import { authorize } from "@/lib/session";

const PATH: Record<AttachmentOwner, string> = { Quotation: "/quotations", Proposal: "/proposals", Customer: "/customers" };

const uploadSchema = z.object({ ownerType: z.enum(AttachmentOwner), ownerId: z.string().min(1), kind: z.string().min(1, "Pick what the file is") });

/** Attach a file to a quotation, proposal or customer the user may act on. */
export async function uploadAttachment(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Lead.View");
  const parsed = uploadSchema.safeParse({ ownerType: form.get("ownerType"), ownerId: form.get("ownerId"), kind: form.get("kind") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { ownerType, ownerId } = parsed.data;
  const file = form.get("file") as File | null;
  const problem = fileProblem(file);
  if (problem) return { ok: false, error: problem };
  const owner = await attachmentOwner(user, ownerType, ownerId);
  if (!owner) return { ok: false, error: "Not found, or it belongs to another user" };
  if (owner.closed) return { ok: false, error: "This record is deleted" };

  // File type from Settings → Dropdown values; "Other" adds the typed one to the list.
  const resolved = await db.$transaction((tx) => resolveDropdown(tx, user, ATTACHMENT_LIST[ownerType], parsed.data.kind, String(form.get("kindOther") ?? "")));
  if ("error" in resolved) return { ok: false, error: resolved.error === "Pick a value from the list" ? "Pick what the file is" : resolved.error };
  const kind = resolved.value;
  const storedName = await storeFile(file!);
  await db.attachment.create({
    data: { tenantId: user.tenantId, ownerType, ownerId, kind, fileName: file!.name.slice(0, 120), storedName, contentType: file!.type, size: file!.size, uploadedById: user.id },
  });
  revalidatePath(`${PATH[ownerType]}/${ownerId}`);
  return { ok: true };
}

/** Remove a file: whoever uploaded it, or an Admin / Super Admin. Logged. */
export async function removeAttachment(attachmentId: string): Promise<ActionResult> {
  const user = await authorize("Lead.View");
  const a = await db.attachment.findFirst({ where: { id: attachmentId, tenantId: user.tenantId } });
  if (!a) return { ok: false, error: "File not found" };
  const owner = await attachmentOwner(user, a.ownerType, a.ownerId);
  if (!owner) return { ok: false, error: "Not found, or it belongs to another user" };
  if (a.uploadedById !== user.id && !seesAll(user.role)) return { ok: false, error: "Only the person who added the file or an Admin can remove it" };
  await db.$transaction(async (tx) => {
    await tx.attachment.delete({ where: { id: a.id } });
    await audit(tx, user, {
      entity: a.ownerType, entityId: a.ownerId, action: "File removed", summary: `${owner.label}: ${a.kind} file ${a.fileName} removed`,
      before: { file: a.fileName, kind: a.kind },
    });
  });
  await deleteStoredFile(a.storedName);
  revalidatePath(`${PATH[a.ownerType]}/${a.ownerId}`);
  return { ok: true };
}
