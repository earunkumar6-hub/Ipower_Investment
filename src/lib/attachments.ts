import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AttachmentOwner } from "@prisma/client";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachment-rules";
import { fmtDate, istDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn, userNames } from "@/lib/leads";
import { seesAll } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";
import { ticketScope } from "@/lib/tickets";

// Files on quotations, proposals and customers. Like expense bills they live in ./storage (outside /public)
// and are served only through /api/attachments/[id] after the same owner check as the record itself.

const DIR = path.join(process.cwd(), "storage", "attachments");
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/** What a file is, per record type. Proposals count the KYC ones ("KYC documents x of 3"). */
// File types per record type live in Settings → Dropdown values (ATTACHMENT_LIST in src/lib/dropdowns.ts).
export const KYC_KINDS = ["Aadhaar", "PAN", "Photo"];

export function fileProblem(file: File | null): string | null {
  if (!file || file.size === 0) return "Choose a file";
  if (!TYPES[file.type]) return "File must be a PDF, JPG, PNG or WEBP";
  if (file.size > MAX_ATTACHMENT_BYTES) return "File must be 5 MB or smaller";
  return null;
}

export async function storeFile(file: File) {
  await mkdir(DIR, { recursive: true });
  const storedName = `${randomUUID()}.${TYPES[file.type]}`;
  await writeFile(path.join(DIR, storedName), Buffer.from(await file.arrayBuffer()));
  return storedName;
}

export const readStoredFile = (storedName: string) => readFile(path.join(DIR, path.basename(storedName)));
export const deleteStoredFile = (storedName: string) => unlink(path.join(DIR, path.basename(storedName))).catch(() => {});

/** The record a file belongs to, if this user may see it (same rule as the record's own page). */
export async function attachmentOwner(user: SessionUser, ownerType: AttachmentOwner, ownerId: string) {
  const where = { id: ownerId, tenantId: user.tenantId };
  if (ownerType === "Ticket") {
    // Tickets: whoever raised it, or anyone who works on tickets (not the customer-owner rule).
    const t = await db.ticket.findFirst({ where: { ...where, ...ticketScope(user) }, select: { ticketNo: true, status: true } });
    return t && { ownerId: user.id, label: t.ticketNo, closed: t.status === "Closed" };
  }
  const rec = ownerType === "Quotation" ? await db.quotation.findFirst({ where, select: { ownerId: true, quoteNo: true, deletedAt: true } }).then((r) => r && { ownerId: r.ownerId, label: r.quoteNo, closed: !!r.deletedAt })
    : ownerType === "Proposal" ? await db.proposal.findFirst({ where, select: { ownerId: true, proposalNo: true } }).then((r) => r && { ownerId: r.ownerId, label: r.proposalNo, closed: false })
    : await db.customer.findFirst({ where, select: { ownerId: true, name: true } }).then((r) => r && { ownerId: r.ownerId, label: r.name, closed: false });
  if (!rec || !canActOn(user, rec.ownerId)) return null;
  return rec;
}

export const listAttachments = (tenantId: string, ownerType: AttachmentOwner, ownerId: string) =>
  db.attachment.findMany({ where: { tenantId, ownerType, ownerId }, orderBy: { createdAt: "desc" } });

/** Rows for the Attachments panel: who added each file and whether this user may remove it. */
export async function attachmentRows(user: SessionUser, ownerType: AttachmentOwner, ownerId: string) {
  const [files, users] = await Promise.all([listAttachments(user.tenantId, ownerType, ownerId), userNames(user.tenantId)]);
  return files.map((f) => ({
    id: f.id, kind: f.kind, fileName: f.fileName, size: f.size, added: fmtDate(istDate(f.createdAt)),
    by: users.find((u) => u.id === f.uploadedById)?.name ?? "—", canRemove: f.uploadedById === user.id || seesAll(user.role),
  }));
}
