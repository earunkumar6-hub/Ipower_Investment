import type { db } from "@/lib/db";

// Staff logins (Settings → Users).

/** What a staff member owns, so their work can be handed over before the login is deleted. */
export async function ownedWork(tx: Pick<typeof db, "customer" | "lead" | "call" | "policy" | "proposal" | "quotation">, userId: string) {
  const [customers, leads, calls, policies, proposals, quotations] = await Promise.all([
    tx.customer.count({ where: { ownerId: userId } }),
    tx.lead.count({ where: { ownerId: userId } }),
    tx.call.count({ where: { ownerId: userId, outcome: null } }),
    tx.policy.count({ where: { ownerId: userId } }),
    tx.proposal.count({ where: { ownerId: userId } }),
    tx.quotation.count({ where: { ownerId: userId } }),
  ]);
  return { customers, leads, calls, policies, proposals, quotations, total: customers + leads + calls + policies + proposals + quotations };
}

