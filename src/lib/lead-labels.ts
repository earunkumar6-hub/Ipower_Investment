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

/** "98xxxxxx21" — list views never show the full mobile. */
export const maskMobile = (m: string) => (m.length >= 6 ? `${m.slice(0, 2)}${"x".repeat(m.length - 4)}${m.slice(-2)}` : m);
