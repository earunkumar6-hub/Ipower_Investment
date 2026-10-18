// Display labels for leads — safe to import from client components.
import type { LeadSource, LeadStatus } from "@prisma/client";

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  New: "New",
  CallScheduled: "Call scheduled",
  Interested: "Interested",
  NotInterested: "Not interested",
  Quoted: "Quoted",
  Converted: "Converted",
};

export const LEAD_STATUS_TONE = {
  New: "blue",
  CallScheduled: "slate",
  Interested: "indigo",
  NotInterested: "orange",
  Quoted: "purple",
  Converted: "green",
} as const satisfies Record<LeadStatus, string>;

export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  Website: "Website",
  WalkIn: "Walk-in",
  Partner: "Partner",
  Call: "Call",
  Referral: "Referral",
};

/** "98xxxxxx21" — list views never show the full mobile. */
export const maskMobile = (m: string) => (m.length >= 6 ? `${m.slice(0, 2)}${"x".repeat(m.length - 4)}${m.slice(-2)}` : m);
