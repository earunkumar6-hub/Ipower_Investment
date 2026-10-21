import { db } from "@/lib/db";
import { canActOn } from "@/lib/leads";
import { hasPermission } from "@/lib/permissions";
import { readPhoto } from "@/lib/photos";
import { getSessionUser } from "@/lib/session";

/** The customer's photo, for whoever may open the customer page. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !hasPermission(user.role, "Policy.View")) return new Response("Not allowed", { status: 403 });
  const { id } = await params;
  const c = await db.customer.findFirst({ where: { id, tenantId: user.tenantId }, select: { ownerId: true, photoPath: true } });
  if (!c || !c.photoPath || !canActOn(user, c.ownerId)) return new Response("Not found", { status: 404 });
  try {
    const { body, type } = await readPhoto(c.photoPath);
    return new Response(new Uint8Array(body), { headers: { "Content-Type": type, "Cache-Control": "private, no-store" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
