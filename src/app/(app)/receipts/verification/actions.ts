"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";

const schema = z
  .object({
    kind: z.enum(["PoDeposit", "CompanyPayment"]),
    id: z.string().min(1),
    status: z.enum(["Verified", "Mismatch"], "Pick Verified or Mismatch"),
    note: z.string().trim().max(200).default(""),
  })
  .refine((v) => v.status === "Verified" || v.note.length >= 3, { message: "Say what doesn't match", path: ["note"] });

/**
 * Checked on the agent portal: RD deposits by PO receipt number, other post office payments by policy number.
 * Verified is final (RD receipts move Deposited → Verified); a Mismatch can be checked again later.
 */
export async function setVerification(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("DayBook.Create");
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, fieldErrors: { [String(issue.path[0])]: issue.message } };
  }
  const { kind, id, status, note } = parsed.data;
  const data = { verifyStatus: status, verifyNote: note || null, verifiedById: user.id, verifiedAt: new Date() };

  const result = await db.$transaction(async (tx): Promise<ActionResult> => {
    const row = kind === "PoDeposit"
      ? await tx.poDeposit.findFirst({ where: { id, tenantId: user.tenantId }, select: { verifyStatus: true, poReceiptNo: true } }).then((d) => d && { status: d.verifyStatus, ref: `PO receipt ${d.poReceiptNo}` })
      : await tx.companyPayment.findFirst({ where: { id, tenantId: user.tenantId, company: "Post Office" }, select: { verifyStatus: true, reference: true } }).then((p) => p && { status: p.verifyStatus, ref: `Post office payment ${p.reference}` });
    if (!row) return { ok: false, error: "Not found" };
    if (row.status === "Verified") return { ok: false, error: "Already verified" };
    if (kind === "PoDeposit") {
      await tx.poDeposit.update({ where: { id }, data });
      if (status === "Verified") {
        await tx.receipt.updateMany({ where: { poDepositLine: { poDepositId: id }, rdStatus: "Deposited" }, data: { rdStatus: "Verified" } });
      }
    } else {
      await tx.companyPayment.update({ where: { id }, data });
    }
    await audit(tx, user, {
      entity: kind, entityId: id, action: "Verify", summary: `${row.ref}: ${status}${note ? ` – ${note}` : ""}`,
      before: { verifyStatus: row.status }, after: { verifyStatus: status },
    });
    return { ok: true };
  });
  if (result.ok) revalidatePath("/receipts");
  return result;
}
