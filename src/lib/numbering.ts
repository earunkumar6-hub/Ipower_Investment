import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";

// Per-tenant running numbers (L-2032, RCPT-0891, …). An advisory lock serialises
// concurrent creators so two users never get the same number.
const SERIES = {
  lead: { table: "Lead", column: "leadNo", prefix: "L-", width: 4 },
  quotation: { table: "Quotation", column: "quoteNo", prefix: "Q-", width: 4 },
  proposal: { table: "Proposal", column: "proposalNo", prefix: "P-", width: 4 },
  receipt: { table: "Receipt", column: "receiptNo", prefix: "RCPT-", width: 4 },
  payment: { table: "Payment", column: "paymentNo", prefix: "PAY-", width: 4 },
  slip: { table: "OwnerPaidSlip", column: "slipNo", prefix: "OWN-", width: 4 },
  service: { table: "ServiceTransaction", column: "txnNo", prefix: "SVC-", width: 4 },
  expense: { table: "Expense", column: "expenseNo", prefix: "EXP-", width: 4 },
} as const;

export async function nextNumber(tx: Tx, tenantId: string, series: keyof typeof SERIES) {
  const s = SERIES[series];
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`number:${tenantId}:${series}`}))`;
  const [{ max }] = await tx.$queryRaw<{ max: number | null }[]>(Prisma.sql`
    SELECT MAX(CAST(substring(${Prisma.raw(`"${s.column}"`)} from '[0-9]+$') AS int)) AS max
    FROM ${Prisma.raw(`"${s.table}"`)} WHERE "tenantId" = ${tenantId}`);
  return `${s.prefix}${String((max ?? 0) + 1).padStart(s.width, "0")}`;
}
