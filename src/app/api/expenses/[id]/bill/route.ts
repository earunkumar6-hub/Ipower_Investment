import { readBill } from "@/lib/bill-storage";
import { db } from "@/lib/db";
import { hasPermission, seesAll } from "@/lib/permissions";
import { getSessionUser } from "@/lib/session";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !hasPermission(user.role, "Expense.View")) return new Response("Not allowed", { status: 403 });
  const { id } = await params;
  const e = await db.expense.findFirst({ where: { id, tenantId: user.tenantId } });
  if (!e?.billPhotoPath || !(seesAll(user.role) || e.createdById === user.id)) return new Response("Not found", { status: 404 });
  const { body, type } = await readBill(e.billPhotoPath);
  return new Response(new Uint8Array(body), { headers: { "Content-Type": type, "Content-Disposition": `inline; filename="${e.expenseNo}-bill"` } });
}
