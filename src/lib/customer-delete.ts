// Deleting a customer (owner, 4 Nov 2026): only one with no records – e.g. added by mistake or twice. Anything
// below keeps the customer; follow-ups, extra mobiles, photo and attached files go with the customer.

/** Prisma `_count` select of everything that keeps a customer. */
export const CUSTOMER_IN_USE = {
  policies: true, jointPolicies: true, proposals: true, jointProposals: true, quotations: true,
  receipts: true, payments: true, ownerPaidSlips: true, directBills: true, serviceTransactions: true,
} as const;

const LABEL: Record<keyof typeof CUSTOMER_IN_USE, [string, string]> = {
  policies: ["product", "products"], jointPolicies: ["joint account", "joint accounts"], proposals: ["proposal", "proposals"],
  jointProposals: ["joint proposal", "joint proposals"], quotations: ["quotation", "quotations"], receipts: ["receipt", "receipts"],
  payments: ["payment", "payments"], ownerPaidSlips: ["owner-paid slip", "owner-paid slips"], directBills: ["direct bill", "direct bills"],
  serviceTransactions: ["E-Sevai entry", "E-Sevai entries"],
};

/** "Has 2 products, 5 receipts – can't be deleted", or null when the customer has no records. */
export function inUseReason(count: Partial<Record<keyof typeof CUSTOMER_IN_USE, number>>): string | null {
  const parts = (Object.keys(LABEL) as (keyof typeof CUSTOMER_IN_USE)[])
    .filter((k) => (count[k] ?? 0) > 0)
    .map((k) => `${count[k]} ${LABEL[k][count[k] === 1 ? 0 : 1]}`);
  return parts.length ? `Has ${parts.join(", ")} – can't be deleted` : null;
}
