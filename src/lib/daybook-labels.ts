// Day Book constants shared by server and client components (no server imports here).

export const CASH_SOURCES = ["PostOffice", "GRM", "ESevai", "PAN", "Others"] as const;
export type CashSource = (typeof CASH_SOURCES)[number];
export const CASH_SOURCE_LABEL: Record<CashSource, string> = { PostOffice: "Post Office", GRM: "GRM", ESevai: "E-Sevai", PAN: "PAN", Others: "Others" };

/** Why the UPI-paid part of a PO deposit differs from the day's ATM withdrawals. */
export const UPI_ADJUSTMENT_REASONS = [
  "Covered from cash in hand",
  "Extra kept as cash in hand",
  "Used for an expense",
  "To be withdrawn next day",
] as const;
