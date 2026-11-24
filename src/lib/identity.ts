import type { Tx } from "@/lib/db";
import { maskMobile } from "@/lib/lead-labels";

// Aadhaar and PAN are stored and shown in full, and may repeat across customers (owner, 24 Nov 2026 – before that: encrypted,
// masked, unique per agency). Company CIF uniqueness (#28) stays: a duplicate is reported with the person it already belongs
// to, for the "already exists" pop-up – there is no way to save over it.

/** 12 digits; UIDAI numbers never start with 0 or 1 (QA D-07, 13 Nov 2026). */
export const AADHAAR_RE = /^[2-9]\d{11}$/;

// The last digit of every Aadhaar number is a Verhoeff check digit: it catches a mistyped or swapped digit.
const V_D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const V_P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
export function verhoeffValid(digits: string) {
  let c = 0;
  [...digits].reverse().forEach((ch, i) => { c = V_D[c][V_P[i % 8][Number(ch)]]; });
  return c === 0;
}
/** 12 digits, first digit 2–9, correct check digit. */
export const isValidAadhaar = (n: string) => AADHAAR_RE.test(n) && verhoeffValid(n);
export const AADHAAR_MESSAGE = "Aadhaar number is not valid: 12 digits, not starting with 0 or 1, with the correct last (check) digit";
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

/** ABCDE1234M → ABCxxxxx4M */
export const maskPan = (pan: string) => `${pan.slice(0, 3)}xxxxx${pan.slice(-2)}`;

/** What to store for the numbers entered (only the ones given). The masked forms are kept for older screens and records. */
export function identityData(aadhaar: string, pan: string) {
  return {
    ...(aadhaar && { aadhaarNo: aadhaar, aadhaarLast4: aadhaar.slice(-4) }),
    ...(pan && { panNo: pan, panMasked: maskPan(pan) }),
  };
}

/** 123456789012 → 1234 5678 9012 */
export const fmtAadhaar = (n: string) => n.replace(/(\d{4})(?=\d)/g, "$1 ");
/** The full Aadhaar when stored; older records that only kept the last four show them masked. null = not collected. */
export const aadhaarText = (full?: string | null, last4?: string | null) => (full ? fmtAadhaar(full) : last4 ? `XXXX-XXXX-${last4}` : null);
/** The full PAN when stored, else the masked form of an older record. null = not collected. */
export const panText = (full?: string | null, masked?: string | null) => full ?? masked ?? null;

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
