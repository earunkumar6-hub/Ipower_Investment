"use server";

import { Frequency, type Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { audit } from "@/lib/audit";
import { istToday } from "@/lib/dates";
import { db, type Tx } from "@/lib/db";
import { advanceStage, canActOn } from "@/lib/leads";
import { nextNumber } from "@/lib/numbering";
import { isMfCategory, isPostalInvestmentType, MF_PAY_MODES, quoteGroup } from "@/lib/products";
import { priceQuotation } from "@/lib/quotation";
import { authorize, type SessionUser } from "@/lib/session";

const money = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount");

const itemSchema = z.object({
  category: z.string().trim().min(1, "Pick a product"),
  insurer: z.string().trim().min(1, "Pick the company"),
  productName: z.string().trim().min(1, "Pick the plan"),
  sumInsured: z.union([z.literal(""), money]),
  premium: z.union([z.literal(""), money]), // may be blank for the post office schemes; checked per product below
  payMode: z.enum(Frequency).default("Yearly"),
});

const quotationSchema = z.object({
  customerId: z.string(),
  leadId: z.string(),
  customerName: z.string().trim().min(2, "Enter the customer name"),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number"),
  validUpto: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  items: z.array(itemSchema).min(1, "Add at least one product").max(5, "At most 5 products"),
});

/** Thrown inside the quotation transaction to roll back everything already written. */
class QuoteRefused extends Error {}

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

  const priced = priceQuotation(v.items.map((i) => i.premium || "0"));
  let quotation;
  try {
    quotation = await db.$transaction(async (tx) => {
      // Product (category), company and plan must be an active product in Settings → Products and schemes (#12, 13 Nov 2026).
      // Throw (not return) so nothing written for earlier products is kept.
      const categories: string[] = [];
      const noCover: boolean[] = []; // mutual fund, or a post office scheme other than PLI: no sum insured is saved
      for (const [n, i] of v.items.entries()) {
        const plan = await tx.product.findFirst({
          where: { tenantId: user.tenantId, active: true, partner: i.insurer, name: i.productName },
          select: { productType: true, partner: true, invoiceRule: true, category: true, payModes: true },
        });
        if (!plan || quoteGroup(plan) !== i.category) throw new QuoteRefused(`Product ${n + 1}: pick a plan from Settings → Products and schemes`);
        const mf = plan.productType === "MutualFund";
        if (mf && !MF_PAY_MODES.includes(i.payMode)) throw new QuoteRefused(`Product ${n + 1}: pick SIP or Lumpsum`);
        if (plan.payModes.length && !plan.payModes.includes(i.payMode)) throw new QuoteRefused(`Product ${n + 1}: pick a pay mode this plan allows`);
        // Post office schemes other than PLI: no sum insured and the amount may be left blank (owner, 11 Nov 2026).
        const investment = isPostalInvestmentType(plan.productType);
        if (!investment) {
          if (!i.premium) throw new QuoteRefused(`Product ${n + 1}: Enter an amount`);
          if (Number(i.premium) <= 0) throw new QuoteRefused(`Product ${n + 1}: Premium must be more than 0`);
        }
        categories.push(i.category);
        noCover.push(mf || investment);
      }
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
          total: priced.total,
          ownerId: customer?.ownerId ?? lead?.ownerId ?? user.id,
          items: {
            create: v.items.map((i, n) => ({
              category: categories[n],
              insurer: i.insurer,
              productName: i.productName,
              sumInsured: noCover[n] ? null : i.sumInsured || null, // no cover on a mutual fund or a post office investment
              payMode: i.payMode,
              ...priced.items[n],
            })),
          },
        },
      });
      if (lead) await advanceStage(tx, lead.id, "Quotation");
      await audit(tx, user, { entity: "Quotation", entityId: q.id, action: "Create", summary: `Quotation ${q.quoteNo} for ${q.customerName} · ${v.items.length} product(s)` });
      return q;
    });
  } catch (e) {
    if (e instanceof QuoteRefused) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(`/quotations/${quotation.id}`);
}

/** A quotation the user may act on, not deleted. */
async function ownQuotation(user: SessionUser, quotationId: string) {
  const q = await db.quotation.findFirst({ where: { id: quotationId, tenantId: user.tenantId, deletedAt: null }, include: { items: { include: { proposal: true } } } });
  if (!q) return { error: "Quotation not found" } as const;
  if (!canActOn(user, q.ownerId)) return { error: "This quotation belongs to another user" } as const;
  return { q } as const;
}

type QuotedItem = { id: string; category: string; insurer: string; productName: string; sumInsured: Prisma.Decimal | null; total: Prisma.Decimal; payMode: Frequency };
type QuoteParty = { id: string; customerId: string | null; customerName: string; mobile: string; ownerId: string };

/** One proposal for a quoted product, linked to the catalogue product when the plan matches. No OTP consent step (owner, 20 Oct 2026). */
async function proposalFor(tx: Tx, user: SessionUser, q: QuoteParty, item: QuotedItem) {
  const product = await tx.product.findFirst({
    where: { tenantId: user.tenantId, partner: item.insurer, name: item.productName },
    include: { schemes: { where: { active: true }, orderBy: { tenureMonths: "asc" } } },
  });
  const onlyScheme = product?.schemes.length === 1 ? product.schemes[0] : null;
  const p: Awaited<ReturnType<typeof tx.proposal.create>> = await tx.proposal.create({
    data: {
      tenantId: user.tenantId, proposalNo: await nextNumber(tx, user.tenantId, "proposal"), quotationId: q.id, quotationItemId: item.id,
      customerId: q.customerId, customerName: q.customerName, mobile: q.mobile, insurer: item.insurer, productName: item.productName,
      sumInsured: item.sumInsured, premium: item.total, status: "Draft", ownerId: q.ownerId,
      productType: product?.productType ?? (isMfCategory(item.category) ? "MutualFund" : "Insurance"), productId: product?.id, schemeId: onlyScheme?.id, frequency: item.payMode, termMonths: onlyScheme?.tenureMonths,
    },
  });
  await audit(tx, user, { entity: "Proposal", entityId: p.id, action: "Create", summary: `Proposal ${p.proposalNo} from ${q.customerName}'s quotation · ${item.insurer} ${item.productName}` });
  return p;
}

/**
 * The customer's decision: the ticked products become proposals (one each), the rest Not accepted.
 * A product marked not accepted can still be confirmed later from the same quotation.
 */
export async function createProposalsFromSelected(quotationId: string, itemIds: string[]): Promise<ActionResult> {
  const user = await authorize("Proposal.Create");
  const r = await ownQuotation(user, quotationId);
  if ("error" in r) return { ok: false, error: r.error };
  const { q } = r;
  if (q.status === "NotAccepted") return { ok: false, error: "This quotation was marked not accepted" };
  if (q.validUpto < istToday() && q.status !== "Accepted") return { ok: false, error: "This quotation has expired; create a new one" };
  const picked = q.items.filter((i) => itemIds.includes(i.id) && !i.proposal);
  if (picked.length === 0) return { ok: false, error: "Tick the products the customer accepted" };

  await db.$transaction(async (tx) => {
    for (const item of picked) await proposalFor(tx, user, q, item);
    const ids = picked.map((i) => i.id);
    await tx.quotationItem.updateMany({ where: { id: { in: ids } }, data: { decision: "Selected" } });
    await tx.quotationItem.updateMany({ where: { quotationId: q.id, decision: "Pending", id: { notIn: ids } }, data: { decision: "NotAccepted" } });
    await tx.quotation.update({ where: { id: q.id }, data: { status: "Accepted", acceptedAt: q.acceptedAt ?? new Date() } });
    if (q.leadId) await advanceStage(tx, q.leadId, "Proposal");
    await audit(tx, user, { entity: "Quotation", entityId: q.id, action: "Accepted", summary: `Quotation ${q.quoteNo}: ${picked.length} product(s) accepted → proposals, the rest not accepted` });
  });
  revalidatePath("/", "layout");
  return { ok: true, message: `${picked.length} proposal${picked.length > 1 ? "s" : ""} created` };
}

const reasonSchema = z.string().trim().min(3, "Enter the reason").max(200);

/** The customer said no to the whole quotation. */
export async function markNotAccepted(quotationId: string, reason: string): Promise<ActionResult> {
  const user = await authorize("Quote.Create");
  const r = await ownQuotation(user, quotationId);
  if ("error" in r) return { ok: false, error: r.error };
  const why = reasonSchema.safeParse(reason);
  if (!why.success) return { ok: false, error: why.error.issues[0].message };
  if (r.q.items.some((i) => i.proposal)) return { ok: false, error: "Proposals were already made from this quotation" };
  await db.$transaction(async (tx) => {
    await tx.quotation.update({ where: { id: r.q.id }, data: { status: "NotAccepted", notAcceptedReason: why.data } });
    await tx.quotationItem.updateMany({ where: { quotationId: r.q.id }, data: { decision: "NotAccepted" } });
    await audit(tx, user, { entity: "Quotation", entityId: r.q.id, action: "NotAccepted", summary: `Quotation ${r.q.quoteNo} marked not accepted`, reason: why.data });
  });
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${r.q.id}`);
  return { ok: true };
}

/** "Mark as sent" (#35): the quotation was given to the customer – it moves from Drafts to Sent. Logged. */
export async function markQuotationSent(quotationId: string): Promise<ActionResult> {
  const user = await authorize("Quote.Create");
  const r = await ownQuotation(user, quotationId);
  if ("error" in r) return { ok: false, error: r.error };
  if (r.q.status !== "Draft") return { ok: false, error: "The customer has already decided on this quotation" };
  if (r.q.sentAt) return { ok: false, error: "Already marked as sent" };
  await db.$transaction(async (tx) => {
    const done = await tx.quotation.updateMany({ where: { id: r.q.id, sentAt: null, status: "Draft" }, data: { sentAt: new Date(), sentById: user.id } });
    if (done.count !== 1) throw new Error("The quotation changed while saving; reload and try again");
    await audit(tx, user, { entity: "Quotation", entityId: r.q.id, action: "Sent", summary: `Quotation ${r.q.quoteNo} for ${r.q.customerName} marked as sent` });
  });
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${r.q.id}`);
  return { ok: true };
}

/** Delete a quotation while no proposal exists; staff their own, Admin any. Kept (hidden) for the change log. */
export async function deleteQuotation(quotationId: string, reason: string): Promise<ActionResult> {
  const user = await authorize("Quote.Create");
  const r = await ownQuotation(user, quotationId);
  if ("error" in r) return { ok: false, error: r.error };
  const why = reasonSchema.safeParse(reason);
  if (!why.success) return { ok: false, error: why.error.issues[0].message };
  if (r.q.items.some((i) => i.proposal)) return { ok: false, error: "A proposal was made from this quotation; it can't be deleted" };
  await db.$transaction(async (tx) => {
    await tx.quotation.update({ where: { id: r.q.id }, data: { deletedAt: new Date(), deletedById: user.id, deleteReason: why.data } });
    await audit(tx, user, {
      entity: "Quotation", entityId: r.q.id, action: "Deleted", summary: `Quotation ${r.q.quoteNo} for ${r.q.customerName} deleted`,
      before: { products: r.q.items.map((i) => `${i.insurer} ${i.productName}`).join(", "), total: r.q.total.toFixed(2) }, reason: why.data,
    });
  });
  revalidatePath("/", "layout");
  return { ok: true, href: "/quotations" };
}
