import type { PaymentMode } from "@prisma/client";

// Labels and constants for payment modes and cash denomination (no server code: used by client forms too).

export const MODE_LABEL: Record<PaymentMode, string> = {
  Cash: "Cash", UPI: "UPI", NetBanking: "Net banking", Cheque: "Cheque", Card: "Card", Bank: "Bank transfer",
};
/** Modes a customer can pay by, in display order (Bank = internal transfers only). */
export const RECEIPT_MODES = ["Cash", "UPI", "NetBanking", "Cheque", "Card"] as const satisfies readonly PaymentMode[];
export type ReceiptMode = (typeof RECEIPT_MODES)[number];
export const REFERENCE_LABEL: Record<Exclude<ReceiptMode, "Cash">, string> = {
  UPI: "UTR", NetBanking: "Transaction ID", Cheque: "Cheque no.", Card: "Card approval no.",
};
export const NOTES = [500, 200, 100, 50, 20, 10] as const;
/** Note counts by face value plus coins in rupees: { "500": 4, "200": 2, coins: "12.50" }. */
export type Denominations = Partial<Record<`${(typeof NOTES)[number]}`, number>> & { coins?: string };

/** "Net banking · HDFC · 55120931", "UPI · UTR 4291…", "Cash". */
export function modeText(r: { mode: PaymentMode; reference?: string | null; bankName?: string | null }) {
  return [MODE_LABEL[r.mode], r.bankName, r.reference].filter(Boolean).join(" · ");
}
