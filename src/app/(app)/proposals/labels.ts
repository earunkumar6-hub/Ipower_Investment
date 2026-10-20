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

type NextInput = { status: ProposalStatus; frequency: unknown; startDate: unknown };

/** What still has to happen before the policy number can be entered. */
export function proposalNext(p: NextInput) {
  if (p.status === "Issued") return "Moved to customer";
  if (!p.frequency || !p.startDate) return "Enter pay mode and start date";
  return "Enter policy number";
}

export const proposalStatusLabel = (p: { status: ProposalStatus }): [string, Tone] => PROPOSAL_STATUS[p.status];
