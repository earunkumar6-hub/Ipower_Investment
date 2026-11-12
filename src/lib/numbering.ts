import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";

// Per-tenant running numbers.
//
// Counter series (owner change list #36–38, #44): one saved counter per series in the database (NumberCounter),
// increased inside the same transaction as the record. The row lock serialises concurrent saves, a number is never
// handed out twice, and a cancelled record keeps its number (it is never reused). Width 2, growing past 99:
//   lead    RR-01 …   (older leads keep L-2032)
//   receipt AA-01 …   shared by a receipt for one bill and one receipt for several bills (Payment), so the customer
//                     always holds one AA- number (older ones keep RCPT- / PAY-)
// Bills are IP-01 … from the database function next_bill_no() (sequence ip_bill_no_seq).
const COUNTERS = {
  lead: { prefix: "RR-", width: 2 },
  receipt: { prefix: "AA-", width: 2 },
} as const;

// Other series: the next number after the highest one of that prefix. An advisory lock serialises concurrent creators.
const SERIES = {
  quotation: { table: "Quotation", column: "quoteNo", prefix: "Q-", width: 4 },
  proposal: { table: "Proposal", column: "proposalNo", prefix: "P-", width: 4 },
  directBill: { table: "DirectBill", column: "billNo", prefix: "DB-", width: 4 },
  slip: { table: "OwnerPaidSlip", column: "slipNo", prefix: "OWN-", width: 4 },
  service: { table: "ServiceTransaction", column: "txnNo", prefix: "SVC-", width: 4 },
  expense: { table: "Expense", column: "expenseNo", prefix: "EXP-", width: 4 },
  ticket: { table: "Ticket", column: "ticketNo", prefix: "TK-", width: 4 },
} as const;

export type NumberSeries = keyof typeof COUNTERS | keyof typeof SERIES;

const pad = (n: number, width: number) => String(n).padStart(width, "0");

export async function nextNumber(tx: Tx, tenantId: string, series: NumberSeries) {
  if (series in COUNTERS) {
    const c = COUNTERS[series as keyof typeof COUNTERS];
    const [{ value }] = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO "NumberCounter" ("tenantId", "series", "value") VALUES (${tenantId}, ${series}, 1)
      ON CONFLICT ("tenantId", "series") DO UPDATE SET "value" = "NumberCounter"."value" + 1
      RETURNING "value"`;
    return `${c.prefix}${pad(value, c.width)}`;
  }
  const s = SERIES[series as keyof typeof SERIES];
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`number:${tenantId}:${series}`}))`;
  const [{ max }] = await tx.$queryRaw<{ max: number | null }[]>(Prisma.sql`
    SELECT MAX(CAST(substring(${Prisma.raw(`"${s.column}"`)} from '[0-9]+$') AS int)) AS max
    FROM ${Prisma.raw(`"${s.table}"`)} WHERE "tenantId" = ${tenantId} AND ${Prisma.raw(`"${s.column}"`)} LIKE ${`${s.prefix}%`}`);
  return `${s.prefix}${pad((max ?? 0) + 1, s.width)}`;
}

/**
 * The bills of one receipt for several bills (#45) are its lines: AA-05/1, AA-05/2 … – the customer holds AA-05 and
 * every bill shows it as its receipt (`receiptRef`). `n` is the line's position, from 1.
 */
export const lineNumber = (receiptNo: string, n: number) => `${receiptNo}/${n}`;
