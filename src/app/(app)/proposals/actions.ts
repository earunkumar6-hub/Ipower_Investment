"use server";

import { Frequency, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { db, type Tx } from "@/lib/db";
import { advanceStage, canActOn } from "@/lib/leads";
import { createPolicyWithSchedule } from "@/lib/policies";
import { rateOn } from "@/lib/products";
import { audit } from "@/lib/audit";
import { AADHAAR_RE, type Duplicate, duplicateCompanyCif, duplicateIdentity, duplicateMessage, identityData, maskPan, PAN_RE } from "@/lib/identity";
import { maskMobile } from "@/lib/lead-labels";
import { authorize, type SessionUser } from "@/lib/session";

/** Refuses an issue inside its transaction, rolling back everything written so far. */
class IssueRefused extends Error {
  constructor(message: string, public duplicate?: Duplicate) {
    super(message);
  }
}

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
  consent: z.string().default(""), // "on" = "Customer consent taken" ticked
  pan: z.string().trim().toUpperCase().pipe(z.union([z.literal(""), z.string().regex(PAN_RE, "PAN looks like ABCDE1234F")])),
  aadhaar: z.string().transform((v) => v.replace(/[\s-]/g, "")).pipe(z.union([z.literal(""), z.string().regex(AADHAAR_RE, "Aadhaar has 12 digits")])),
});

/**
 * #1 + #13 / #28: Aadhaar / PAN can be saved only once "Customer consent taken" is ticked (who / when recorded).
 * Both stay optional. The full numbers are stored encrypted; one that already belongs to someone else is refused with
 * their details for the pop-up. Editable until the policy is issued.
 */
export async function saveKyc(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("PII.Edit");
  const proposalId = String(form.get("proposalId"));
  const parsed = kycSchema.safeParse({ consent: form.get("consent") ?? "", pan: form.get("pan") ?? "", aadhaar: form.get("aadhaar") ?? "" });
  const res = await db.$transaction(async (tx): Promise<ActionResult> => {
    const r = await loadProposal(tx, user, proposalId);
    if ("error" in r) return { ok: false, error: r.error };
    const { p } = r;
    if (p.status === "Issued") return { ok: false, error: "Policy already issued" };
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      return { ok: false, error: i.message, fieldErrors: { [String(i.path[0])]: i.message } };
    }
    const { pan, aadhaar } = parsed.data;
    const consentNow = !p.consentAt && parsed.data.consent === "on";
    if (!p.consentAt && !consentNow) return { ok: false, error: "Tick “Customer consent taken” first", fieldErrors: { consent: "Required" } };
    const consent = consentNow ? { consentAt: new Date(), consentById: user.id } : {};
    if (!pan && !aadhaar) {
      if (!consentNow) return { ok: false, error: "Enter the Aadhaar or PAN to save (both are optional)" };
      await tx.proposal.update({ where: { id: p.id }, data: consent });
      await audit(tx, user, { entity: "Proposal", entityId: p.id, action: "Consent", summary: `${p.proposalNo}: customer consent taken` });
      return { ok: true, message: "Consent recorded" };
    }
    const data = identityData(aadhaar, pan);
    const person = p.customerId ? { customerId: p.customerId, mobile: p.mobile } : { customerId: (await customerByMobile(tx, user.tenantId, p.mobile))?.id, mobile: p.mobile };
    const duplicate = await duplicateIdentity(tx, user.tenantId, { aadhaarHash: data.aadhaarHash, panHash: data.panHash }, person, p.id);
    if (duplicate) return { ok: false, error: duplicateMessage(duplicate), duplicate };
    await tx.proposal.update({ where: { id: p.id }, data: { ...data, ...consent } });
    await audit(tx, user, {
      entity: "Proposal", entityId: p.id, action: "Updated",
      summary: `${p.proposalNo}: ${[aadhaar && `Aadhaar XXXX-XXXX-${aadhaar.slice(-4)}`, pan && `PAN ${maskPan(pan)}`].filter(Boolean).join(" · ")}${consentNow ? " · consent taken" : ""}`,
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
      // Joint account: the second holder is the customer picked, else the customer with that mobile, else a new one.
      let secondHolderId: string | null = null;
      if (p.jointAccount) {
        const second =
          (p.secondHolderId && (await tx.customer.findFirst({ where: { id: p.secondHolderId, tenantId: user.tenantId } }))) ||
          (p.secondHolderMobile && (await customerByMobile(tx, user.tenantId, p.secondHolderMobile))) ||
          (p.secondHolderName && p.secondHolderMobile
            ? await tx.customer.create({
                data: {
                  tenantId: user.tenantId, name: p.secondHolderName, mobile: p.secondHolderMobile, ownerId: p.ownerId,
                  mobiles: { create: [{ tenantId: user.tenantId, number: p.secondHolderMobile, isWhatsApp: false, sort: 0 }] },
                },
              })
            : null);
        // Thrown, not returned, so a first-holder customer created above is rolled back too.
        if (!second) throw new IssueRefused("Pick the second holder, or untick Joint account");
        if (second.id === customer.id) throw new IssueRefused("The second holder can't be the first holder");
        secondHolderId = second.id;
      }
      // Aadhaar / PAN are optional; copy whichever was entered (full values encrypted), never over a different one.
      if (p.aadhaarHash && customer.aadhaarHash && customer.aadhaarHash !== p.aadhaarHash) {
        throw new IssueRefused(`The Aadhaar on this proposal doesn't match ${customer.name}'s (XXXX-XXXX-${customer.aadhaarLast4}); correct it first`);
      }
      if (p.panHash && customer.panHash && customer.panHash !== p.panHash) throw new IssueRefused(`The PAN on this proposal doesn't match ${customer.name}'s (${customer.panMasked}); correct it first`);
      if (p.aadhaarHash || p.panHash) {
        const duplicate = await duplicateIdentity(tx, user.tenantId, { aadhaarHash: p.aadhaarHash ?? undefined, panHash: p.panHash ?? undefined }, { customerId: customer.id, mobile: customer.mobile }, p.id);
        if (duplicate && duplicate.customerId) throw new IssueRefused(duplicateMessage(duplicate), duplicate);
      }
      if (p.panMasked || p.aadhaarLast4 || p.consentAt) {
        await tx.customer.update({
          where: { id: customer.id },
          data: {
            panMasked: p.panMasked ?? customer.panMasked, aadhaarLast4: p.aadhaarLast4 ?? customer.aadhaarLast4,
            ...(p.aadhaarHash && { aadhaarEnc: p.aadhaarEnc, aadhaarHash: p.aadhaarHash }),
            ...(p.panHash && { panEnc: p.panEnc, panHash: p.panHash }),
            ...(p.consentAt && !customer.consentAt && { consentAt: p.consentAt, consentById: p.consentById }),
          },
        });
      }

      const product = p.productId ? await tx.product.findUnique({ where: { id: p.productId } }) : null;
      const scheme = p.schemeId ? await tx.scheme.findUnique({ where: { id: p.schemeId }, include: { rates: true } }) : null;
      await createPolicyWithSchedule(tx, {
        tenantId: user.tenantId, customerId: customer.id, secondHolderId, ownerId: p.ownerId, proposalId: p.id, policyNumber,
        firstHolderCif: p.firstHolderCif, secondHolderCif: p.jointAccount ? p.secondHolderCif : null,
        productType: p.productType, partner: p.insurer, productName: p.productName, productId: p.productId, schemeId: p.schemeId,
        premiumAmount: p.premium, frequency: p.frequency, startDate: p.startDate, termMonths: p.termMonths, sumAssured: p.sumInsured,
        premiumPayingTermMonths: p.premiumPayingTermMonths, nominee: p.nominee, customValues: (p.customValues ?? undefined) as Prisma.InputJsonValue | undefined,
        bankDetailsEnc: p.bankDetailsEnc, rateAtOpen: p.rateAtOpen ?? (scheme ? rateOn(scheme.rates, p.startDate)?.rate : null), invoiceRule: product?.invoiceRule,
      });
      await tx.proposal.update({ where: { id: p.id }, data: { status: "Issued", policyNumber, customerId: customer.id, secondHolderId } });
      if (p.quotation?.leadId) await advanceStage(tx, p.quotation.leadId, "Customer");
      return { ok: true, id: customer.id };
    });
    revalidatePath("/", "layout");
    return res;
  } catch (e) {
    if (e instanceof IssueRefused) return { ok: false, error: e.message, duplicate: e.duplicate };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: `Policy number ${policyNumber} already exists` };
    }
    throw e;
  }
}

/** The customer whose main or extra mobile this is (oldest first). */
function customerByMobile(tx: Tx, tenantId: string, mobile: string) {
  return tx.customer.findFirst({ where: { tenantId, OR: [{ mobile }, { mobiles: { some: { number: mobile } } }] }, orderBy: { createdAt: "asc" } });
}

const jointSchema = z.object({
  proposalId: z.string().min(1),
  jointAccount: z.enum(["on", "off"]),
  secondHolderId: z.string().trim().default(""),
  secondHolderName: z.string().trim().max(80).default(""),
  secondHolderMobile: z.union([z.literal(""), z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number")]).default(""),
  // CIFs given by the post office / insurer to each holder (optional until issued, typed like the policy number)
  firstHolderCif: z.string().trim().toUpperCase().max(40, "CIF is too long").default(""),
  secondHolderCif: z.string().trim().toUpperCase().max(40, "CIF is too long").default(""),
});

/**
 * Account holders: the holder's CIF from the company (single or joint), and for a joint account (#12):
 * the proposal's customer is the first holder; the second is an existing customer, or a new
 * person (name + mobile) – a customer with that mobile is linked instead. Editable until the policy is issued; logged.
 */
export async function saveJointAccount(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Proposal.Create");
  const parsed = jointSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: i.message, fieldErrors: { [String(i.path[0])]: i.message } };
  }
  const v = parsed.data;
  const res = await db.$transaction(async (tx): Promise<ActionResult> => {
    const r = await loadProposal(tx, user, v.proposalId);
    if ("error" in r) return { ok: false, error: r.error };
    const { p } = r;
    if (p.status === "Issued") return { ok: false, error: "Policy already issued; the holders can't be changed here" };

    // The company CIF belongs to one person per company (Post Office, LIC…).
    const firstPerson = { customerId: p.customerId ?? (await customerByMobile(tx, user.tenantId, p.mobile))?.id, mobile: p.mobile };
    if (v.firstHolderCif) {
      const duplicate = await duplicateCompanyCif(tx, user.tenantId, p.insurer, v.firstHolderCif, firstPerson, p.id);
      if (duplicate) return { ok: false, error: `${v.firstHolderCif}: ${duplicateMessage(duplicate)}`, duplicate, fieldErrors: { firstHolderCif: "Already used" } };
    }

    if (v.jointAccount === "off") {
      // Single holder: only the holder's CIF from the company is kept.
      const cif = v.firstHolderCif || null;
      if (!p.jointAccount && p.firstHolderCif === cif) return { ok: true };
      await tx.proposal.update({ where: { id: p.id }, data: { jointAccount: false, secondHolderId: null, secondHolderName: null, secondHolderMobile: null, firstHolderCif: cif, secondHolderCif: null } });
      await audit(tx, user, {
        entity: "Proposal", entityId: p.id, action: "Updated",
        summary: `${p.proposalNo}: ${p.jointAccount ? "joint account removed · " : ""}holder CIF ${cif ?? "—"}`,
        before: { cif: p.firstHolderCif }, after: { cif },
      });
      return { ok: true };
    }

    let second: { id: string; name: string; cifNo: string } | null = null;
    let message: string | undefined;
    if (v.secondHolderId) {
      second = await tx.customer.findFirst({ where: { id: v.secondHolderId, tenantId: user.tenantId }, select: { id: true, name: true, cifNo: true } });
      if (!second) return { ok: false, error: "Pick the second holder again" };
    } else {
      if (v.secondHolderName.length < 2) return { ok: false, error: "Enter the second holder's name", fieldErrors: { secondHolderName: "Required" } };
      if (!v.secondHolderMobile) return { ok: false, error: "Enter the second holder's mobile", fieldErrors: { secondHolderMobile: "Required" } };
      if (v.secondHolderMobile === p.mobile) return { ok: false, error: "That is the first holder's mobile", fieldErrors: { secondHolderMobile: "Same as first holder" } };
      const match = await customerByMobile(tx, user.tenantId, v.secondHolderMobile);
      if (match) {
        second = { id: match.id, name: match.name, cifNo: match.cifNo };
        message = `This mobile belongs to customer ${match.name} (${match.cifNo}); linked them as the second holder`;
      }
    }
    if (second && second.id === p.customerId) return { ok: false, error: "The second holder can't be the first holder" };

    if (v.firstHolderCif && v.firstHolderCif === v.secondHolderCif) return { ok: false, error: "The two holders can't have the same CIF", fieldErrors: { secondHolderCif: "Same CIF" } };
    if (v.secondHolderCif) {
      const secondPerson = second
        ? { customerId: second.id, mobile: (await tx.customer.findUnique({ where: { id: second.id }, select: { mobile: true } }))?.mobile }
        : { mobile: v.secondHolderMobile };
      const duplicate = await duplicateCompanyCif(tx, user.tenantId, p.insurer, v.secondHolderCif, secondPerson, p.id);
      if (duplicate) return { ok: false, error: `${v.secondHolderCif}: ${duplicateMessage(duplicate)}`, duplicate, fieldErrors: { secondHolderCif: "Already used" } };
    }
    const cifs = { firstHolderCif: v.firstHolderCif || null, secondHolderCif: v.secondHolderCif || null };
    await tx.proposal.update({
      where: { id: p.id },
      data: second
        ? { jointAccount: true, secondHolderId: second.id, secondHolderName: null, secondHolderMobile: null, ...cifs }
        : { jointAccount: true, secondHolderId: null, secondHolderName: v.secondHolderName, secondHolderMobile: v.secondHolderMobile, ...cifs },
    });
    await audit(tx, user, {
      entity: "Proposal", entityId: p.id, action: "Updated",
      summary: `${p.proposalNo}: joint account – second holder ${second ? `${second.name} (${second.cifNo})` : `${v.secondHolderName} (new customer on issue)`}`
        + ` · company CIFs ${v.firstHolderCif || "—"} / ${v.secondHolderCif || "—"}`,
    });
    return { ok: true, message };
  });
  if (res.ok) revalidatePath(`/proposals/${v.proposalId}`);
  return res;
}

/** Second-holder picker: customers matching a name, CIF or mobile (mobile shown masked). */
export async function searchCustomers(q: string): Promise<{ id: string; name: string; cifNo: string; mobile: string }[]> {
  const user = await authorize("Proposal.Create");
  const text = q.trim();
  if (text.length < 2) return [];
  const rows = await db.customer.findMany({
    where: {
      tenantId: user.tenantId,
      OR: [{ name: { contains: text, mode: "insensitive" } }, { cifNo: { contains: text, mode: "insensitive" } }, { mobile: { contains: text } }, { mobiles: { some: { number: { contains: text } } } }],
    },
    select: { id: true, name: true, cifNo: true, mobile: true },
    orderBy: { name: "asc" },
    take: 8,
  });
  return rows.map((c) => ({ ...c, mobile: maskMobile(c.mobile) }));
}
