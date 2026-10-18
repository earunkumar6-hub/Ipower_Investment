import type { ProductType } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { D, round2 } from "@/lib/money";

// Post office commission and TDS (Section 194H). Fixed for the demo; the full build
// reads CommissionRate with an effective-from date.
const PO_RATES: Partial<Record<ProductType, { rate: string; tdsRate: string }>> = {
  PoRd: { rate: "0.004", tdsRate: "0.02" },
  PoTd: { rate: "0.005", tdsRate: "0.02" },
  PoKvp: { rate: "0.005", tdsRate: "0.02" },
  PoNsc: { rate: "0.005", tdsRate: "0.02" },
};

/** e.g. RD 1,000 → gross 4.00, TDS 0.08, net 3.92; TD 1,00,000 → 500.00, 10.00, 490.00. */
export function poCommission(productType: ProductType, baseAmount: Prisma.Decimal.Value) {
  const r = PO_RATES[productType];
  if (!r) throw new Error(`No post office commission rate for ${productType}`);
  const gross = round2(new D(baseAmount).times(r.rate));
  const tds = round2(gross.times(r.tdsRate));
  return { baseAmount: new D(baseAmount), rate: new D(r.rate), gross, tdsRate: new D(r.tdsRate), tds, net: gross.minus(tds) };
}
