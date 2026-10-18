import type { ServiceRate } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { D, fmtINR, round2 } from "@/lib/money";

export class RateNotConfiguredError extends Error {
  constructor(code: string, base: Prisma.Decimal) {
    super(`No ${code} service charge is set for a bill of ${fmtINR(base)}. Rates exist only for under ₹1,000 and ₹2,000–₹29,999 (open decision).`);
    this.name = "RateNotConfiguredError";
  }
}

export type RateRow = Pick<ServiceRate, "minAmount" | "maxAmount" | "serviceCharge" | "walletCost" | "fixedCustomerAmount" | "effectiveFrom">;

/** Rates in force on `date`: for each slab (or the fixed rate) the latest effectiveFrom on or before it. */
export async function ratesInForce(tx: Tx, serviceTypeId: string, date: Date): Promise<RateRow[]> {
  const rows = await tx.serviceRate.findMany({
    where: { serviceTypeId, effectiveFrom: { lte: date } },
    orderBy: { effectiveFrom: "desc" },
  });
  const latest = new Map<string, RateRow>();
  for (const r of rows) {
    const key = `${r.minAmount ?? ""}-${r.maxAmount ?? ""}`;
    if (!latest.has(key)) latest.set(key, r);
  }
  return [...latest.values()];
}

/**
 * Slab rate (EB): customer pays bill + slab charge; provider cost is the bill.
 * Fixed rate (PAN, certificate): customer pays a fixed amount; provider cost is fixed.
 */
export function priceService(code: string, rates: RateRow[], baseAmount: Prisma.Decimal.Value) {
  const fixed = rates.find((r) => r.fixedCustomerAmount !== null);
  if (fixed) {
    const customerAmount = new D(fixed.fixedCustomerAmount!);
    const walletCost = new D(fixed.walletCost ?? 0);
    const profit = customerAmount.minus(walletCost);
    return { baseAmount: customerAmount, serviceCharge: profit, walletCost, customerAmount, profit };
  }
  const base = round2(baseAmount);
  if (base.lte(0)) throw new Error("Enter the bill amount");
  const slab = rates.find((r) => r.minAmount && r.maxAmount && base.gte(r.minAmount) && base.lte(r.maxAmount));
  if (!slab?.serviceCharge) throw new RateNotConfiguredError(code, base);
  const charge = new D(slab.serviceCharge);
  return { baseAmount: base, serviceCharge: charge, walletCost: base, customerAmount: base.plus(charge), profit: charge };
}
