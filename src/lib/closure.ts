import type { ProductType } from "@prisma/client";

export type ClosureButton =
  | { state: "hidden"; text: "Not allowed" }
  | { state: "locked"; until: Date; text: string }
  | { state: "active"; withdraw: boolean; lockInUntil: Date | null };

/**
 * The Premature closure button on a customer's holding (Settings → Products: "Premature closure allowed",
 * "Can be closed during the lock-in period"). Mutual funds are always withdrawn with a withdraw date instead.
 */
export function closureButton(
  p: { productType: ProductType; product: { prematureClosure: boolean; closeDuringLockIn: boolean } | null },
  lockIn: Date | null, today: Date, fmt: (d: Date) => string,
): ClosureButton {
  if (p.productType === "MutualFund") return { state: "active", withdraw: true, lockInUntil: null };
  if (p.product && !p.product.prematureClosure) return { state: "hidden", text: "Not allowed" };
  const inLockIn = !!lockIn && lockIn > today;
  if (inLockIn && !p.product?.closeDuringLockIn) return { state: "locked", until: lockIn!, text: `Greyed out until ${fmt(lockIn!)} (lock-in)` };
  // The closure date can't be inside the lock-in unless the product allows closing during it.
  return { state: "active", withdraw: false, lockInUntil: p.product?.closeDuringLockIn ? null : lockIn };
}
