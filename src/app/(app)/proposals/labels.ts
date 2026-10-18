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
