"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/(app)/leads/actions";
import { istToday } from "@/lib/dates";
import { db, type Tx } from "@/lib/db";
import { canActOn } from "@/lib/leads";
import { renewalDueDates } from "@/lib/renewals";
import { authorize, type SessionUser } from "@/lib/session";

async function loadProposal(tx: Tx, user: SessionUser, proposalId: string) {
  const p = await tx.proposal.findFirst({
    where: { id: proposalId, tenantId: user.tenantId },
    include: { consents: { orderBy: { createdAt: "desc" }, take: 1 }, quotation: true },
  });
  if (!p) return { error: "Proposal not found" } as const;
  if (!canActOn(user, p.ownerId)) return { error: "This proposal belongs to another user" } as const;
  return { p, consent: p.consents[0] ?? null } as const;
}

/** Demo stand-in for the customer opening the consent link and entering the OTP. */
export async function simulateCustomerOtp(proposalId: string): Promise<ActionResult> {
  const user = await authorize("Proposal.Create");
  const res = await db.$transaction(async (tx) => {
    const r = await loadProposal(tx, user, proposalId);
    if ("error" in r) return { ok: false, error: r.error };
    const { p, consent } = r;
    if (!consent || consent.status !== "Sent") return { ok: false, error: "No consent request is waiting" };
    if (consent.expiresOn < new Date()) {
      await tx.consent.update({ where: { id: consent.id }, data: { status: "Expired" } });
      return { ok: false, error: "The consent link expired; resend it" };
    }
    await tx.consent.update({ where: { id: consent.id }, data: { status: "Given", otpVerifiedOn: new Date(), ipAddress: "simulated (demo)" } });
    await tx.proposal.update({ where: { id: p.id }, data: { status: "ConsentGiven" } });
    return { ok: true };
  });
  revalidatePath(`/proposals/${proposalId}`);
  return res;
}

const kycSchema = z.object({
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, "PAN looks like ABCDE1234F"),
  aadhaar: z.string().transform((v) => v.replace(/[\s-]/g, "")).pipe(z.union([z.literal(""), z.string().regex(/^\d{12}$/, "Aadhaar has 12 digits")])),
});

/** ABCDE1234M → ABCxxxxx4M (demo stores the masked value only; no encryption). */
const maskPan = (pan: string) => `${pan.slice(0, 3)}xxxxx${pan.slice(-2)}`;

/** Aadhaar/PAN are rejected unless the customer's consent is Given. */
export async function saveKyc(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("PII.Edit");
  const proposalId = String(form.get("proposalId"));
  const parsed = kycSchema.safeParse({ pan: form.get("pan") ?? "", aadhaar: form.get("aadhaar") ?? "" });
  const res = await db.$transaction(async (tx) => {
    const r = await loadProposal(tx, user, proposalId);
    if ("error" in r) return { ok: false, error: r.error };
    if (r.consent?.status !== "Given") return { ok: false, error: "Locked: the customer has not given OTP consent yet" };
    if (r.p.status === "Issued") return { ok: false, error: "Policy already issued" };
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    await tx.proposal.update({
      where: { id: r.p.id },
      data: { panMasked: maskPan(parsed.data.pan), aadhaarLast4: parsed.data.aadhaar ? parsed.data.aadhaar.slice(-4) : r.p.aadhaarLast4 },
    });
    return { ok: true };
  });
  revalidatePath(`/proposals/${proposalId}`);
  return res;
}

const issueSchema = z.object({
  proposalId: z.string(),
  policyNumber: z.string().trim().toUpperCase().min(4, "Enter the policy number").max(40),
});

/** The policy number turns the proposal into a customer policy with its renewal schedule. */
export async function issuePolicy(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await authorize("Policy.Create");
  const parsed = issueSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { proposalId, policyNumber } = parsed.data;

  try {
    const res = await db.$transaction(async (tx) => {
      const r = await loadProposal(tx, user, proposalId);
      if ("error" in r) return { ok: false, error: r.error };
      const { p, consent } = r;
      if (p.status === "Issued") return { ok: false, error: "Policy already issued" };
      if (consent?.status !== "Given") return { ok: false, error: "Customer consent is required before submitting" };
      if (!p.panMasked) return { ok: false, error: "Enter the customer's PAN first" };

      // One person, many policies: reuse the customer by id, else by mobile.
      const customer =
        (p.customerId && (await tx.customer.findFirst({ where: { id: p.customerId, tenantId: user.tenantId } }))) ||
        (await tx.customer.findFirst({ where: { tenantId: user.tenantId, mobile: p.mobile } })) ||
        (await tx.customer.create({ data: { tenantId: user.tenantId, name: p.customerName, mobile: p.mobile, ownerId: p.ownerId } }));
      await tx.customer.update({
        where: { id: customer.id },
        data: { panMasked: p.panMasked, aadhaarLast4: p.aadhaarLast4 ?? customer.aadhaarLast4 },
      });

      const startDate = istToday();
      const policy = await tx.policy.create({
        data: {
          tenantId: user.tenantId, customerId: customer.id, proposalId: p.id, productType: "Insurance",
          partner: p.insurer, productName: p.productName, policyNumber, premiumAmount: p.premium,
          frequency: "Yearly", startDate, sumAssured: p.sumInsured, ownerId: p.ownerId,
        },
      });
      const dues = renewalDueDates(startDate, "Yearly");
      await tx.renewalItem.createMany({
        data: dues.map((dueDate) => ({ tenantId: user.tenantId, policyId: policy.id, dueDate, premiumAmount: p.premium })),
      });
      await tx.proposal.update({ where: { id: p.id }, data: { status: "Issued", policyNumber, customerId: customer.id } });
      if (p.quotation.leadId) await tx.lead.update({ where: { id: p.quotation.leadId }, data: { status: "Converted" } });
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
