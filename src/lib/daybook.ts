import type { Direction, EntryType, PaymentMode, SourceType } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { addDays, fmtDate, isoDate } from "@/lib/dates";
import type { Tx } from "@/lib/db";
import { D, ZERO } from "@/lib/money";

// Day Book core: every money movement is an immutable entry; corrections are reversals;
// a closed day accepts nothing. All functions run inside the caller's transaction.

export class DayClosedError extends Error {
  constructor(date: Date) {
    super(`Day Book for ${fmtDate(date)} is closed; closed days are read-only`);
    this.name = "DayClosedError";
  }
}

export type PostLine = {
  /** Unique within the source, e.g. "in", "wallet-out". */
  key: string;
  accountId: string;
  direction: Direction;
  amount: Prisma.Decimal.Value;
  entryType: EntryType;
  mode?: PaymentMode;
  isPassThrough?: boolean;
  particulars: string;
  productCategory?: string;
  scheme?: string;
  notes?: string;
};

export type PostInput = {
  tenantId: string;
  entryDate: Date;
  sourceType: SourceType;
  sourceId?: string;
  sourceNo?: string;
  createdById: string;
  lines: PostLine[];
};

/**
 * Serialises posting against closing for one tenant-day: posts take the lock shared,
 * closing takes it exclusive, so nothing slips into a day while it is being closed.
 */
export async function lockDay(tx: Tx, tenantId: string, date: Date, mode: "shared" | "exclusive") {
  const key = `daybook:${tenantId}:${isoDate(date)}`;
  if (mode === "shared") await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${key}))`;
  else await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

export async function isDayClosed(tx: Tx, tenantId: string, date: Date) {
  const closed = await tx.dayClose.findFirst({ where: { tenantId, date, status: "Closed" }, select: { id: true } });
  return closed !== null;
}

/** Guard for any write dated on `date` (posting, or editing a record from that day). */
export async function assertDayOpen(tx: Tx, tenantId: string, date: Date) {
  await lockDay(tx, tenantId, date, "shared");
  if (await isDayClosed(tx, tenantId, date)) throw new DayClosedError(date);
}

const idempotencyKey = (input: PostInput, line: PostLine) =>
  `${input.sourceType}:${input.sourceId ?? input.sourceNo}:${line.key}`;

/** Write entries for one business event. Re-posting the same event is a no-op. */
export async function post(tx: Tx, input: PostInput) {
  await assertDayOpen(tx, input.tenantId, input.entryDate);
  const lines = input.lines.filter((l) => !new D(l.amount).isZero());
  for (const l of lines) {
    if (new D(l.amount).isNegative()) throw new Error(`Negative amount on Day Book line ${l.key}`);
  }
  const keys = lines.map((l) => idempotencyKey(input, l));
  await tx.dayBookEntry.createMany({
    skipDuplicates: true,
    data: lines.map((l, i) => ({
      tenantId: input.tenantId,
      entryDate: input.entryDate,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceNo: input.sourceNo,
      createdById: input.createdById,
      accountId: l.accountId,
      direction: l.direction,
      amount: new D(l.amount),
      entryType: l.entryType,
      mode: l.mode,
      isPassThrough: l.isPassThrough ?? false,
      particulars: l.particulars,
      productCategory: l.productCategory,
      scheme: l.scheme,
      notes: l.notes,
      idempotencyKey: keys[i],
    })),
  });
  return tx.dayBookEntry.findMany({ where: { idempotencyKey: { in: keys } } });
}

/**
 * Reverse every live entry of a source (e.g. a cancelled receipt). Reversals are dated
 * `entryDate` (normally today), so a closed day's entries stay untouched.
 */
export async function reverseSource(
  tx: Tx,
  args: { tenantId: string; sourceType: SourceType; sourceId: string; entryDate: Date; createdById: string; reason: string },
) {
  const live = await tx.dayBookEntry.findMany({
    where: { tenantId: args.tenantId, sourceType: args.sourceType, sourceId: args.sourceId, reversalOfId: null, reversedBy: { is: null } },
  });
  if (live.length === 0) return []; // nothing moved, so nothing to reverse — even on a closed day
  await assertDayOpen(tx, args.tenantId, args.entryDate);
  const created = [];
  for (const e of live) {
    created.push(
      await tx.dayBookEntry.create({
        data: {
          tenantId: e.tenantId,
          accountId: e.accountId,
          entryDate: args.entryDate,
          direction: e.direction === "In" ? "Out" : "In",
          amount: e.amount,
          entryType: e.entryType,
          mode: e.mode,
          isPassThrough: e.isPassThrough,
          sourceType: e.sourceType,
          sourceId: e.sourceId,
          sourceNo: e.sourceNo,
          particulars: `Reversal: ${e.particulars}`,
          productCategory: e.productCategory,
          scheme: e.scheme,
          notes: args.reason,
          reversalOfId: e.id,
          idempotencyKey: `rev:${e.id}`,
          createdById: args.createdById,
        },
      }),
    );
  }
  return created;
}

export type AccountDay = {
  accountId: string;
  name: string;
  type: "Cash" | "Bank" | "Wallet";
  opening: Prisma.Decimal;
  totalIn: Prisma.Decimal;
  totalOut: Prisma.Decimal;
  closing: Prisma.Decimal;
};

/** Opening, in, out and closing for every account on `date`, computed from entries. */
export async function accountDay(tx: Tx, tenantId: string, date: Date): Promise<AccountDay[]> {
  const accounts = await tx.account.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  const sums = await tx.dayBookEntry.groupBy({
    by: ["accountId", "direction"],
    where: { tenantId, entryDate: { lte: date } },
    _sum: { amount: true },
  });
  const today = await tx.dayBookEntry.groupBy({
    by: ["accountId", "direction"],
    where: { tenantId, entryDate: date },
    _sum: { amount: true },
  });
  const pick = (rows: typeof sums, accountId: string, direction: Direction) =>
    rows.find((r) => r.accountId === accountId && r.direction === direction)?._sum.amount ?? ZERO;

  return accounts.map((a) => {
    const closing = new D(a.openingBalance).plus(pick(sums, a.id, "In")).minus(pick(sums, a.id, "Out"));
    const totalIn = pick(today, a.id, "In");
    const totalOut = pick(today, a.id, "Out");
    return {
      accountId: a.id,
      name: a.name,
      type: a.type,
      opening: closing.minus(totalIn).plus(totalOut),
      totalIn,
      totalOut,
      closing,
    };
  });
}

/** Balance of one account at end of `date`. */
export async function balanceAt(tx: Tx, accountId: string, date: Date) {
  const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
  const sums = await tx.dayBookEntry.groupBy({
    by: ["direction"],
    where: { accountId, entryDate: { lte: date } },
    _sum: { amount: true },
  });
  const s = (d: Direction) => sums.find((r) => r.direction === d)?._sum.amount ?? ZERO;
  return new D(account.openingBalance).plus(s("In")).minus(s("Out"));
}

/** Earliest day before `date` that has entries but is not closed (blocks closing `date`). */
export async function earliestOpenDayBefore(tx: Tx, tenantId: string, date: Date): Promise<Date | null> {
  const lastClosed = await tx.dayClose.findFirst({
    where: { tenantId, status: "Closed", date: { lt: date } },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const from = lastClosed ? addDays(lastClosed.date, 1) : undefined;
  const pending = await tx.dayBookEntry.findFirst({
    where: { tenantId, entryDate: { lt: date, ...(from && { gte: from }) } },
    orderBy: { entryDate: "asc" },
    select: { entryDate: true },
  });
  return pending?.entryDate ?? null;
}
