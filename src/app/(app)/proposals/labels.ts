import type { ProposalStatus } from "@prisma/client";
import type { Tone } from "@/components/status-badge";

// No OTP consent step (owner, 20 Oct 2026): a proposal waits only for its policy details and the policy number.
// ConsentPending / ConsentGiven remain on older proposals and read the same as Draft.
export const PROPOSAL_STATUS: Record<ProposalStatus, [string, Tone]> = {
  Draft: ["Policy number pending", "orange"],
  ConsentPending: ["Policy number pending", "orange"],
  ConsentGiven: ["Policy number pending", "orange"],
  Issued: ["Policy issued", "green"],
};

type NextInput = { status: ProposalStatus; frequency: unknown; startDate: unknown; productType?: string | null };

/** Mutual funds call the policy number the "Folio number" (owner, 6 Nov 2026). */
export const policyNumberLabel = (productType?: string | null) => (productType === "MutualFund" ? "Folio number" : "Policy number");

/** What still has to happen before the policy number can be entered. */
export function proposalNext(p: NextInput) {
  if (p.status === "Issued") return "Moved to customer";
  if (!p.frequency || !p.startDate) return "Enter pay mode and start date";
  return `Enter ${policyNumberLabel(p.productType).toLowerCase()}`;
}

export const proposalStatusLabel = (p: { status: ProposalStatus; productType?: string | null }): [string, Tone] => {
  const [label, tone] = PROPOSAL_STATUS[p.status];
  return p.status === "Issued" ? [label, tone] : [`${policyNumberLabel(p.productType)} pending`, tone];
};

/** "Meena R + Ravi R (joint)" for a joint account, else the customer's name. */
export function holdersLabel(p: { customerName: string; jointAccount: boolean; secondHolderName: string | null; secondHolder?: { name: string } | null }) {
  const second = p.secondHolder?.name ?? p.secondHolderName;
  return p.jointAccount && second ? `${p.customerName} + ${second} (joint)` : p.customerName;
}
