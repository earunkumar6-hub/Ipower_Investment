"use server";

import { Frequency, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { db, type Tx } from "@/lib/db";
import { advanceStage, canActOn } from "@/lib/leads";
import { createPolicyWithSchedule } from "@/lib/policies";
import { rateOn } from "@/lib/products";
import { authorize, type SessionUser } from "@/lib/session";

async function loadProposal(tx: Tx, user: SessionUser, proposalId: string) {
  const p = await tx.proposal.findFirst({
    where: { id: proposalId, tenantId: user.tenantId },
    include: { quotation: true },
  });
  if (!p) return { error: "Proposal not found" } as const;
  if (!canActOn(user, p.ownerId)) return { error: "This proposal belongs to another user" } as const;
  return { p } as const;
}

const kycSchema = z.object({
  pan: z.string().trim().toUpperCase().pipe(z.union([z.literal(""), z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "PAN looks like ABCDE1234F")])),
  aadhaar: z.string().transform((v) => v.replace(/[\s-]/g, "")).pipe(z.union([z.literal(""), z.string().regex(/^\d{12}$/, "Aadhaar has 12 digits")])),
});

/** ABCDE1234M → ABCxxxxx4M (demo stores the masked value only; no encryption). */
const maskPan = (pan: string) => `${pan.slice(0, 3)}xxxxx${pan.slice(-2)}`;

/** Aadhaar / PAN: optional, stored masked, editable until the policy is issued (no OTP consent step – owner, 20 Oct 2026). */
export async function saveKyc(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("PII.Edit");
  const proposalId = String(form.get("proposalId"));
  const parsed = kycSchema.safeParse({ pan: form.get("pan") ?? "", aadhaar: form.get("aadhaar") ?? "" });
  const res = await db.$transaction(async (tx) => {
    const r = await loadProposal(tx, user, proposalId);
    if ("error" in r) return { ok: false, error: r.error };
    if (r.p.status === "Issued") return { ok: false, error: "Policy already issued" };
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    if (!parsed.data.pan && !parsed.data.aadhaar) return { ok: false, error: "Enter the Aadhaar or PAN to save (both are optional)" };
    await tx.proposal.update({
      where: { id: r.p.id },
      data: { panMasked: parsed.data.pan ? maskPan(parsed.data.pan) : r.p.panMasked, aadhaarLast4: parsed.data.aadhaar ? parsed.data.aadhaar.slice(-4) : r.p.aadhaarLast4 },
    });
    return { ok: true };
  });
  revalidatePath(`/proposals/${proposalId}`);
  return res;
}

const years = z.string().trim().regex(/^(\d{1,2}(\.5)?)?$/, "Years must be a number like 5 or 2.5").transform((v) => (v ? Math.round(Number(v) * 12) : null));

const detailsSchema = z.object({
  proposalId: z.string(),
  frequency: z.enum(Frequency, "Pick the pay mode"),
  term: years,
  premiumPayingTerm: years,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the start date").transform((v) => new Date(`${v}T00:00:00Z`)),
  schemeId: z.string().default(""),
});

/** Pay mode, term, start date and premium paying term – used to build the renewal schedule when the policy number comes. */
export async function savePolicyDetails(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Proposal.Create");
  const parsed = detailsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  if (v.premiumPayingTerm && v.term && v.premiumPayingTerm > v.term) return { ok: false, error: "Premium paying term can't be longer than the term" };
  const res = await db.$transaction(async (tx) => {
    const r = await loadProposal(tx, user, v.proposalId);
    if ("error" in r) return { ok: false, error: r.error };
    if (r.p.status === "Issued") return { ok: false, error: "Policy already issued" };
    const scheme = v.schemeId && r.p.productId ? await tx.scheme.findFirst({ where: { id: v.schemeId, productId: r.p.productId } }) : null;
    if (v.schemeId && !scheme) return { ok: false, error: "Pick a scheme of this product" };
    await tx.proposal.update({
      where: { id: r.p.id },
      data: { frequency: v.frequency, termMonths: v.term ?? scheme?.tenureMonths ?? null, startDate: v.startDate, premiumPayingTermMonths: v.premiumPayingTerm, ...(scheme && { schemeId: scheme.id }) },
    });
    return { ok: true };
  });
  revalidatePath(`/proposals/${v.proposalId}`);
  return res;
}

const issueSchema = z.object({
  proposalId: z.string(),
  policyNumber: z.string().trim().toUpperCase().min(4, "Enter the policy number").max(40),
});

/**
 * The policy number turns the proposal into a customer policy with its renewal schedule (pay mode, term and
 * start date from the proposal). Only the pay mode and start date are needed first; OTP consent, Aadhaar / PAN and
 * KYC documents are not required (owner, 20 Oct 2026).
 */
export async function issuePolicy(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Policy.Create");
  const parsed = issueSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { proposalId, policyNumber } = parsed.data;

  try {
    const res = await db.$transaction(async (tx) => {
      const r = await loadProposal(tx, user, proposalId);
      if ("error" in r) return { ok: false, error: r.error };
      const { p } = r;
      if (p.status === "Issued") return { ok: false, error: "Policy already issued" };
      if (!p.frequency || !p.startDate) return { ok: false, error: "Save the pay mode and start date first" };

      // One person, many policies: reuse the customer by id, else by any of their mobile numbers.
      const lead = p.quotation?.leadId ? await tx.lead.findUnique({ where: { id: p.quotation.leadId }, include: { mobiles: { orderBy: { sort: "asc" } } } }) : null;
      const customer =
        (p.customerId && (await tx.customer.findFirst({ where: { id: p.customerId, tenantId: user.tenantId } }))) ||
        (await tx.customer.findFirst({ where: { tenantId: user.tenantId, mobiles: { some: { number: p.mobile } } } })) ||
        (await tx.customer.create({
          data: {
            tenantId: user.tenantId, name: p.customerName, mobile: p.mobile, ownerId: p.ownerId, email: lead?.email, address: lead?.address,
            mobiles: {
              create: (lead?.mobiles.length ? lead.mobiles : [{ number: p.mobile, isWhatsApp: false }])
                .map((m, sort) => ({ tenantId: user.tenantId, number: m.number, isWhatsApp: m.isWhatsApp, sort })),
            },
          },
        }));
      // Aadhaar / PAN are optional; copy whichever was entered.
      if (p.panMasked || p.aadhaarLast4) {
        await tx.customer.update({ where: { id: customer.id }, data: { panMasked: p.panMasked ?? customer.panMasked, aadhaarLast4: p.aadhaarLast4 ?? customer.aadhaarLast4 } });
      }

      const product = p.productId ? await tx.product.findUnique({ where: { id: p.productId } }) : null;
      const scheme = p.schemeId ? await tx.scheme.findUnique({ where: { id: p.schemeId }, include: { rates: true } }) : null;
      await createPolicyWithSchedule(tx, {
        tenantId: user.tenantId, customerId: customer.id, ownerId: p.ownerId, proposalId: p.id, policyNumber,
        productType: p.productType, partner: p.insurer, productName: p.productName, productId: p.productId, schemeId: p.schemeId,
        premiumAmount: p.premium, frequency: p.frequency, startDate: p.startDate, termMonths: p.termMonths, sumAssured: p.sumInsured,
        premiumPayingTermMonths: p.premiumPayingTermMonths, nominee: p.nominee, customValues: (p.customValues ?? undefined) as Prisma.InputJsonValue | undefined,
        bankDetailsEnc: p.bankDetailsEnc, rateAtOpen: p.rateAtOpen ?? (scheme ? rateOn(scheme.rates, p.startDate)?.rate : null), invoiceRule: product?.invoiceRule,
      });
      await tx.proposal.update({ where: { id: p.id }, data: { status: "Issued", policyNumber, customerId: customer.id } });
      if (p.quotation?.leadId) await advanceStage(tx, p.quotation.leadId, "Customer");
      return { ok: true, id: customer.id };
    });
    revalidatePath("/", "layout");
    return res;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: `Policy number ${policyNumber} already exists` };
    }
    throw e;
  }
}
