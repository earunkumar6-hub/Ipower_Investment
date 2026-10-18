import { Prisma } from "@prisma/client";

export const D = Prisma.Decimal;
export type Decimal = Prisma.Decimal;
export const ZERO = new D(0);

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inrPaise = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });

/** ₹1,10,500 — Indian grouping, paise only when present (₹860.50). */
export function fmtINR(v: Prisma.Decimal.Value) {
  const d = new D(v).toDecimalPlaces(2);
  return (d.isInteger() ? inr : inrPaise).format(Number(d.toFixed(2)));
}

/** Round to 2 places (half-up), as stored. */
export const round2 = (v: Prisma.Decimal.Value) => new D(v).toDecimalPlaces(2, D.ROUND_HALF_UP);

export const sum = (values: Prisma.Decimal.Value[]) => values.reduce<Prisma.Decimal>((a, v) => a.plus(v), ZERO);
