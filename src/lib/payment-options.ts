import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { receivingAccount } from "@/lib/accounts";
import type { Tx } from "@/lib/db";
import { D, fmtINR } from "@/lib/money";
import { MODE_LABEL, modeText, NET_TYPES, NOTES, RECEIPT_MODES, REFERENCE_LABEL, type Denominations, type ReceiptMode } from "@/lib/payment-modes";

// Payment modes offered on receipts / direct bills, net banking banks (Settings → Payment modes) and cash denomination.
// Plain labels / constants (safe for client components) live in payment-modes.ts.

export { MODE_LABEL, modeText, NOTES, RECEIPT_MODES, REFERENCE_LABEL, type Denominations, type ReceiptMode };

export const DEFAULT_BANKS = ["SBI", "HDFC", "IOB", "Indian Bank", "Canara Bank", "ICICI", "Axis"];

/** Rows for a new tenant (the migration adds the same for existing tenants). */
export const defaultPayOptions = (tenantId: string): Prisma.PaymentOptionCreateManyInput[] => [
  ...RECEIPT_MODES.map((name, i) => ({ tenantId, kind: "Mode" as const, name, sort: i + 1 })),
  ...DEFAULT_BANKS.map((name, i) => ({ tenantId, kind: "Bank" as const, name, sort: i + 1 })),
];

/** Switched-on modes (display order) and bank names. */
export async function payOptions(tx: Pick<Tx, "paymentOption">, tenantId: string) {
  const rows = await tx.paymentOption.findMany({ where: { tenantId, active: true }, orderBy: [{ sort: "asc" }, { name: "asc" }] });
  const on = new Set(rows.filter((r) => r.kind === "Mode").map((r) => r.name));
  return {
    modes: RECEIPT_MODES.filter((m) => on.has(m)) as ReceiptMode[],
    banks: rows.filter((r) => r.kind === "Bank").map((r) => r.name),
  };
}

export function denominationTotal(d: Denominations) {
  return NOTES.reduce((t, n) => t.plus(new D(n).times(d[`${n}`] ?? 0)), new D(d.coins || 0));
}

const denominationSchema = z.object({
  ...Object.fromEntries(NOTES.map((n) => [`${n}`, z.number().int().min(0).max(100000).optional()])),
  coins: z.union([z.literal(""), z.string().regex(/^\d+(\.\d{1,2})?$/)]).optional(),
}) as unknown as z.ZodType<Denominations>;

/** "₹500 × 4, ₹200 × 2, coins ₹12.50" for the bill, receipt page and PDF. */
export function denominationText(d: unknown) {
  const parsed = denominationSchema.safeParse(d);
  if (!parsed.success) return "";
  const v = parsed.data;
  const parts = NOTES.filter((n) => (v[`${n}`] ?? 0) > 0).map((n) => `₹${n} × ${v[`${n}`]}`);
  if (v.coins && Number(v.coins) > 0) parts.push(`coins ${fmtINR(v.coins)}`);
  return parts.join(", ");
}

const parseJson = (v: string): unknown => {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

/** Form fields shared by receipts and direct bills: mode, reference, bank name, cash denomination (JSON), received into. */
export const payFields = {
  mode: z.enum(RECEIPT_MODES, "Pick the payment mode"),
  intoAccountId: z.string().trim().default(""), // "Received into" bank account; not used for cash
  reference: z.string().trim().max(60).default(""),
  bankName: z.string().trim().max(60).default(""),
  netType: z.string().trim().default(""),
  denominations: z.string().default(""),
};
type PayInput = { mode: ReceiptMode; reference: string; bankName: string; netType: string; denominations: string; intoAccountId: string };

/**
 * Cash notes/coins (JSON from the CashDenominationGrid) must add up to `amount`.
 * Returns the error or the value to store.
 */
export function checkDenominations(raw: string, amount: Prisma.Decimal): { error: string } | { ok: Prisma.InputJsonValue } {
  const parsed = denominationSchema.safeParse(parseJson(raw));
  if (!raw || !parsed.success) return { error: "Enter the cash denomination (notes and coins)" };
  const total = denominationTotal(parsed.data);
  if (!total.equals(amount)) return { error: `Cash denomination adds up to ${fmtINR(total)}, not ${fmtINR(amount)}` };
  return { ok: parsed.data as Prisma.InputJsonValue };
}

/** Form field carrying the cash denomination JSON. */
export const denominationsField = z.string().default("");

/**
 * Checks the mode is switched on, the reference / bank it needs, that cash notes add up to `amount`, and the
 * account the money came into (cash drawer, or the active bank account picked as "Received into").
 * Returns the error (with its field) or the values to store.
 */
export async function checkPayment(tx: Pick<Tx, "paymentOption" | "account">, tenantId: string, v: PayInput, amount: Prisma.Decimal) {
  const opts = await payOptions(tx, tenantId);
  const fail = (field: string, error: string) => ({ error, field }) as const;
  if (!opts.modes.includes(v.mode)) return fail("mode", `${MODE_LABEL[v.mode]} is switched off in Settings`);
  if (v.mode === "Cash") {
    const cash = checkDenominations(v.denominations, amount);
    if ("error" in cash) return fail("denominations", cash.error);
    const into = await receivingAccount(tx, tenantId, v.mode, "");
    if ("error" in into) return fail("intoAccountId", into.error);
    return { ok: { reference: null, bankName: null, netType: null, denominations: cash.ok, accountId: into.ok.id } } as const;
  }
  if (!v.reference) return fail("reference", `Enter the ${REFERENCE_LABEL[v.mode].toLowerCase()}`);
  if (v.mode === "NetBanking") {
    if (!(NET_TYPES as readonly string[]).includes(v.netType)) return fail("netType", "Pick NEFT, IMPS or RTGS");
    if (!v.bankName) return fail("bankName", "Pick the customer's bank");
    if (!opts.banks.includes(v.bankName)) return fail("bankName", `${v.bankName} is not in the bank list (Settings → Payment modes)`);
  }
  const into = await receivingAccount(tx, tenantId, v.mode, v.intoAccountId);
  if ("error" in into) return fail("intoAccountId", into.error);
  const net = v.mode === "NetBanking";
  return { ok: { reference: v.reference, bankName: net ? v.bankName : null, netType: net ? v.netType : null, denominations: undefined, accountId: into.ok.id } } as const;
}
