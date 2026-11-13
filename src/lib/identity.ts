import type { Prisma } from "@prisma/client";
import { encryptJson, fingerprint } from "@/lib/crypto";
import type { Tx } from "@/lib/db";
import { maskMobile } from "@/lib/lead-labels";

// Aadhaar, PAN and company CIF uniqueness (#13, #28). Full Aadhaar / PAN are stored encrypted with a keyed fingerprint
// (unique per agency in the database); screens show only the masked forms. A duplicate is reported with the person it
// already belongs to, for the "already exists" pop-up – there is no way to save over it.

/** 12 digits; UIDAI numbers never start with 0 or 1 (QA D-07, 13 Nov 2026). */
export const AADHAAR_RE = /^[2-9]\d{11}$/;
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

/** ABCDE1234M → ABCxxxxx4M */
export const maskPan = (pan: string) => `${pan.slice(0, 3)}xxxxx${pan.slice(-2)}`;

/** What to store for the numbers entered (only the ones given). */
export function identityData(aadhaar: string, pan: string) {
  return {
    ...(aadhaar && { aadhaarEnc: encryptJson(aadhaar), aadhaarHash: fingerprint("aadhaar", aadhaar), aadhaarLast4: aadhaar.slice(-4) }),
    ...(pan && { panEnc: encryptJson(pan), panHash: fingerprint("pan", pan), panMasked: maskPan(pan) }),
  };
}

/** Shown in the duplicate pop-up. `customerId` null = a proposal for someone not yet a customer. */
export type Duplicate = {
  customerId: string | null; proposalId: string | null; name: string; cifNo: string | null; mobile: string;
  matchedOn: string[]; products: string[];
};

/** The person entering the number: their customer (if any) and mobile, so their own records don't count as duplicates. */
export type SamePerson = { customerId?: string | null; mobile?: string | null };
/** Same customer, or the same mobile (customers are matched by mobile across the CRM). */
const isSame = (same: SamePerson, customerId: string | null, mobile: string | null) =>
  (!!same.customerId && same.customerId === customerId) || (!!same.mobile && same.mobile === mobile);

async function customerProducts(tx: Tx, customerId: string) {
  const ps = await tx.policy.findMany({ where: { OR: [{ customerId }, { secondHolderId: customerId }] }, select: { partner: true, productName: true, policyNumber: true, status: true }, take: 8 });
  return ps.map((p) => `${p.partner} ${p.productName} · ${p.policyNumber}${p.status === "Active" ? "" : ` (${p.status})`}`);
}

/** A customer, or an open proposal of someone else, that already has this Aadhaar / PAN. */
export async function duplicateIdentity(
  tx: Tx, tenantId: string, h: { aadhaarHash?: string; panHash?: string }, same: SamePerson, exceptProposalId?: string,
): Promise<Duplicate | null> {
  const or: Prisma.CustomerWhereInput[] = [...(h.aadhaarHash ? [{ aadhaarHash: h.aadhaarHash }] : []), ...(h.panHash ? [{ panHash: h.panHash }] : [])];
  if (!or.length) return null;
  const matched = (r: { aadhaarHash: string | null; panHash: string | null }) =>
    [...(h.aadhaarHash && r.aadhaarHash === h.aadhaarHash ? ["Aadhaar"] : []), ...(h.panHash && r.panHash === h.panHash ? ["PAN"] : [])];

  const customers = await tx.customer.findMany({ where: { tenantId, OR: or }, select: { id: true, name: true, cifNo: true, mobile: true, aadhaarHash: true, panHash: true } });
  const c = customers.find((x) => !isSame(same, x.id, x.mobile));
  if (c) return { customerId: c.id, proposalId: null, name: c.name, cifNo: c.cifNo, mobile: maskMobile(c.mobile), matchedOn: matched(c), products: await customerProducts(tx, c.id) };

  const proposals = await tx.proposal.findMany({
    where: { tenantId, status: { not: "Issued" }, ...(exceptProposalId && { id: { not: exceptProposalId } }), OR: or as Prisma.ProposalWhereInput[] },
    select: { id: true, proposalNo: true, customerId: true, customerName: true, mobile: true, insurer: true, productName: true, aadhaarHash: true, panHash: true },
  });
  const p = proposals.find((x) => !isSame(same, x.customerId, x.mobile));
  if (p) return { customerId: p.customerId, proposalId: p.id, name: p.customerName, cifNo: null, mobile: maskMobile(p.mobile), matchedOn: matched(p), products: [`Proposal ${p.proposalNo} · ${p.insurer} ${p.productName}`] };
  return null;
}

/** A company CIF (per company: Post Office, LIC…) already held by a different person on a policy or an open proposal. */
export async function duplicateCompanyCif(tx: Tx, tenantId: string, partner: string, cif: string, same: SamePerson, exceptProposalId: string): Promise<Duplicate | null> {
  const label = `${partner} CIF`;
  const policies = await tx.policy.findMany({
    where: { tenantId, partner, OR: [{ firstHolderCif: cif }, { secondHolderCif: cif }] },
    include: { customer: { select: { id: true, name: true, cifNo: true, mobile: true } }, secondHolder: { select: { id: true, name: true, cifNo: true, mobile: true } } },
  });
  for (const p of policies) {
    const holder = p.firstHolderCif === cif ? p.customer : p.secondHolder;
    if (holder && !isSame(same, holder.id, holder.mobile)) {
      return { customerId: holder.id, proposalId: null, name: holder.name, cifNo: holder.cifNo, mobile: maskMobile(holder.mobile), matchedOn: [label], products: await customerProducts(tx, holder.id) };
    }
  }
  const proposals = await tx.proposal.findMany({
    where: { tenantId, insurer: partner, status: { not: "Issued" }, id: { not: exceptProposalId }, OR: [{ firstHolderCif: cif }, { secondHolderCif: cif }] },
    include: { secondHolder: { select: { id: true, name: true, mobile: true } } },
  });
  for (const p of proposals) {
    const first = p.firstHolderCif === cif;
    const holder = first
      ? { id: p.customerId, name: p.customerName, mobile: p.mobile }
      : { id: p.secondHolderId, name: p.secondHolder?.name ?? p.secondHolderName ?? "—", mobile: p.secondHolder?.mobile ?? p.secondHolderMobile ?? "" };
    if (!isSame(same, holder.id, holder.mobile)) {
      return { customerId: holder.id, proposalId: p.id, name: holder.name, cifNo: null, mobile: maskMobile(holder.mobile), matchedOn: [label], products: [`Proposal ${p.proposalNo} · ${p.insurer} ${p.productName}`] };
    }
  }
  return null;
}

/** "Aadhaar and PAN already belong to Meena R". */
export const duplicateMessage = (d: Duplicate) => `${d.matchedOn.join(" and ")} already ${d.matchedOn.length > 1 ? "belong" : "belongs"} to ${d.name}${!d.customerId && d.proposalId ? " (on another proposal)" : ""}`;
