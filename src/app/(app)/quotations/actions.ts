"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { addDays, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { advanceStage, canActOn } from "@/lib/leads";
import { nextNumber } from "@/lib/numbering";
import { priceQuotation } from "@/lib/quotation";
import { authorize } from "@/lib/session";

const money = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount");

const itemSchema = z.object({
  category: z.string().trim().min(1, "Pick a product"),
  insurer: z.string().trim().min(2, "Enter the insurer"),
  productName: z.string().trim().min(2, "Enter the plan"),
  sumInsured: z.union([z.literal(""), money]),
  premium: money.refine((v) => Number(v) > 0, "Premium must be more than 0"),
});

const quotationSchema = z.object({
  customerId: z.string(),
  leadId: z.string(),
  customerName: z.string().trim().min(2, "Enter the customer name"),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number"),
  validUpto: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  items: z.array(itemSchema).min(1, "Add at least one product").max(5, "At most 5 products"),
});

export async function createQuotation(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Quote.Create");
  let items: unknown;
  try {
    items = JSON.parse(String(form.get("items") ?? "[]"));
  } catch {
    return { ok: false, error: "Products could not be read" };
  }
  const parsed = quotationSchema.safeParse({ ...Object.fromEntries(form), items });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first.path[0] === "items" ? `Product ${Number(first.path[1] ?? 0) + 1}: ${first.message}` : first.message };
  }
  const v = parsed.data;
  const validUpto = new Date(`${v.validUpto}T00:00:00Z`);
  if (validUpto < istToday()) return { ok: false, error: "Valid till must be today or later" };

  // Quote only for a customer or lead the user may act on.
  const [customer, lead] = await Promise.all([
    v.customerId ? db.customer.findFirst({ where: { id: v.customerId, tenantId: user.tenantId } }) : null,
    v.leadId ? db.lead.findFirst({ where: { id: v.leadId, tenantId: user.tenantId } }) : null,
  ]);
  if ((v.customerId && !customer) || (v.leadId && !lead)) return { ok: false, error: "Customer or lead not found" };
  if ((customer && !canActOn(user, customer.ownerId)) || (lead && !canActOn(user, lead.ownerId))) {
    return { ok: false, error: "This customer belongs to another user" };
  }

  const priced = priceQuotation(v.items.map((i) => i.premium));
  const quotation = await db.$transaction(async (tx) => {
    const q = await tx.quotation.create({
      data: {
        tenantId: user.tenantId,
        quoteNo: await nextNumber(tx, user.tenantId, "quotation"),
        customerId: customer?.id,
        leadId: lead?.id,
        customerName: v.customerName,
        mobile: v.mobile,
        validUpto,
        subtotal: priced.subtotal,
        gstTotal: priced.gstTotal,
        total: priced.total,
        ownerId: customer?.ownerId ?? lead?.ownerId ?? user.id,
        items: {
          create: v.items.map((i, n) => ({
            category: i.category,
            insurer: i.insurer,
            productName: i.productName,
            sumInsured: i.sumInsured || null,
            ...priced.items[n],
          })),
        },
      },
    });
    if (lead) await advanceStage(tx, lead.id, "Quotation");
    return q;
  });
  revalidatePath("/", "layout");
  redirect(`/quotations/${quotation.id}`);
}

export async function acceptQuotation(quotationId: string): Promise<ActionResult> {
  const user = await authorize("Quote.Create");
  const q = await db.quotation.findFirst({ where: { id: quotationId, tenantId: user.tenantId } });
  if (!q) return { ok: false, error: "Quotation not found" };
  if (!canActOn(user, q.ownerId)) return { ok: false, error: "This quotation belongs to another user" };
  if (q.status === "Accepted") return { ok: true };
  if (q.validUpto < istToday()) return { ok: false, error: "This quotation has expired; create a new one" };
  await db.quotation.update({ where: { id: q.id }, data: { status: "Accepted", acceptedAt: new Date() } });
  revalidatePath(`/quotations/${q.id}`);
  revalidatePath("/quotations");
  return { ok: true };
}

/** Proposal for one product of an accepted quotation; sends the (mocked) consent link. */
export async function createProposal(quotationItemId: string): Promise<ActionResult> {
  const user = await authorize("Proposal.Create");
  const item = await db.quotationItem.findFirst({
    where: { id: quotationItemId, quotation: { tenantId: user.tenantId } },
    include: { quotation: true, proposal: true },
  });
  if (!item) return { ok: false, error: "Product not found" };
  const q = item.quotation;
  if (!canActOn(user, q.ownerId)) return { ok: false, error: "This quotation belongs to another user" };
  if (q.status !== "Accepted") return { ok: false, error: "Mark the quotation accepted first" };
  if (item.proposal) redirect(`/proposals/${item.proposal.id}`);

  const proposal = await db.$transaction(async (tx) => {
    const p = await tx.proposal.create({
      data: {
        tenantId: user.tenantId,
        proposalNo: await nextNumber(tx, user.tenantId, "proposal"),
        quotationId: q.id,
        quotationItemId: item.id,
        customerId: q.customerId,
        customerName: q.customerName,
        mobile: q.mobile,
        insurer: item.insurer,
        productName: item.productName,
        sumInsured: item.sumInsured,
        premium: item.total,
        status: "ConsentPending",
        ownerId: q.ownerId,
      },
    });
    if (q.leadId) await advanceStage(tx, q.leadId, "Proposal");
    await tx.consent.create({
      data: {
        tenantId: user.tenantId, proposalId: p.id, customerId: q.customerId, mobile: q.mobile,
        purpose: "Aadhaar and PAN for insurance proposal", textVersion: "KYC-v1", expiresOn: addDays(new Date(), 2),
      },
    });
    const body = `IPower Investments - R. Murali needs your consent to collect Aadhaar and PAN for your ${item.insurer} ${item.productName} proposal ${p.proposalNo}. Open the link and enter the OTP: https://consent.example/${p.id.slice(-8)}`;
    await tx.messageLog.createMany({
      data: (["SMS", "WhatsApp"] as const).map((channel) => ({
        tenantId: user.tenantId, channel, to: q.mobile, template: "kyc_consent_link", body,
        relatedType: "Proposal", relatedId: p.id, createdById: user.id,
      })),
    });
    return p;
  });
  revalidatePath("/", "layout");
  redirect(`/proposals/${proposal.id}`);
}
