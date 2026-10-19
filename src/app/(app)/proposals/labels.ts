import type { ConsentStatus, ProposalStatus } from "@prisma/client";
import type { Tone } from "@/components/status-badge";

export const PROPOSAL_STATUS: Record<ProposalStatus, [string, Tone]> = {
  Draft: ["Draft", "slate"],
  ConsentPending: ["Waiting for OTP", "orange"],
  ConsentGiven: ["Consent given", "indigo"],
  Issued: ["Policy issued", "green"],
};

export const PROPOSAL_NEXT: Record<ProposalStatus, string> = {
  Draft: "Send consent link",
  ConsentPending: "Customer OTP",
  ConsentGiven: "Enter policy number",
  Issued: "Moved to customer",
};

export const CONSENT_TONE: Record<ConsentStatus, Tone> = {
  Sent: "orange",
  Given: "green",
  Declined: "red",
  Expired: "red",
  Withdrawn: "red",
};

type NextInput = { status: ProposalStatus; quotationId: string | null; panMasked: string | null; frequency: unknown; startDate: unknown };

/** What still has to happen before the policy number can be entered. */
export function proposalNext(p: NextInput) {
  if (p.status === "Issued") return PROPOSAL_NEXT.Issued;
  if (p.quotationId && p.status !== "ConsentGiven") return PROPOSAL_NEXT[p.status];
  if (p.quotationId && !p.panMasked) return "Enter PAN";
  if (!p.frequency || !p.startDate) return "Enter pay mode and start date";
  return PROPOSAL_NEXT.ConsentGiven;
}

/** Products added directly on an existing customer need no consent step. */
export const proposalStatusLabel = (p: { status: ProposalStatus; quotationId: string | null }): [string, Tone] =>
  !p.quotationId && p.status !== "Issued" ? ["Policy number pending", "orange"] : PROPOSAL_STATUS[p.status];
