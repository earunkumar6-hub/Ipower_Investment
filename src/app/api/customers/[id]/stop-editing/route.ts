import { db } from "@/lib/db";
import { releaseEditLock } from "@/lib/customer-lock";
import { getSessionUser } from "@/lib/session";

// Sent by the browser (navigator.sendBeacon) when Edit details is left open and the page is closed or navigated away:
// gives the "editing" ticket back at once instead of after its 5 minutes. Only the signed-in holder's own ticket goes.
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response(null, { status: 401 });
  await releaseEditLock(db, (await params).id, user.id);
  return new Response(null, { status: 204 });
}
