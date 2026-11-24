// Display labels for leads and calls — safe to import from client components.
import type { CallOutcome, Gender, LeadSource, LeadStage, LeadStatus } from "@prisma/client";

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  Interested: "Interested",
  NotInterested: "Not interested",
  CallBack: "Call back",
};

export const LEAD_STATUS_TONE = {
  Interested: "green",
  NotInterested: "orange",
  CallBack: "blue",
} as const satisfies Record<LeadStatus, string>;

/** Moved by the system as the lead goes through quotation, proposal and policy. */
export const LEAD_STAGE_LABEL: Record<LeadStage, string> = {
  Lead: "Lead",
  Quotation: "Quotation",
  Proposal: "Proposal",
  Customer: "Partner / Customer",
};

/** "Business type" on the owner's screens. */
export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  Direct: "Direct",
  WalkIn: "Walk-in",
  Referral: "Referral",
  Website: "Website",
  SocialMedia: "Social media",
};

export const GENDER_LABEL: Record<Gender, string> = { Female: "Female", Male: "Male", Other: "Other" };

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  Interested: "Interested",
  NotInterested: "Not interested",
  NoAnswer: "No answer / call back",
  Done: "Done",
};

/** Mobiles are shown in full everywhere (owner, 24 Nov 2026). Kept as a function so the many places that show a number need no change; it used to mask all but 4 digits. */
export const maskMobile = (m: string) => m;
