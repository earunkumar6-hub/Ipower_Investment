import { attachmentOwner, readStoredFile } from "@/lib/attachments";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

/** Serves an attachment to users who may see the record it belongs to. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Not allowed", { status: 403 });
  const a = await db.attachment.findFirst({ where: { id: (await params).id, tenantId: user.tenantId } });
  if (!a || !(await attachmentOwner(user, a.ownerType, a.ownerId))) return new Response("Not found", { status: 404 });
  const body = await readStoredFile(a.storedName).catch(() => null);
  if (!body) return new Response("File missing", { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": a.contentType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(a.fileName)}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
