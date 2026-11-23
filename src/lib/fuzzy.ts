import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// Typo-tolerant name search for the list screens ("Murli" finds "Murali"), on top of the plain `contains` match.
// The filters in lists.ts stay synchronous: a page asks `fuzzyMatches` first and passes the ids in, and each filter
// adds `{ id: { in: ids } }` next to its exact matches, so tenant / owner scoping still applies to every row.
// Names only – numbers (mobile, policy, bill, receipt) stay exact, a near match on those would be a wrong record.

/** Fewer letters than this: plain match only (a 1–2 letter fuzzy match returns half the list). */
export const FUZZY_MIN_LENGTH = 3;
/** A search term this long (or longer) matches anywhere in a name or number; shorter ones match word starts only. */
export const longEnough = (q: string) => q.length >= FUZZY_MIN_LENGTH;
/** pg_trgm word similarity (0–1) a name must reach. */
export const FUZZY_THRESHOLD = 0.4;
const FUZZY_LIMIT = 200;

/** Searchable tables and their name column (identifiers are fixed here, never taken from input). */
const TARGETS = {
  customer: { table: "Customer", column: "name" },
  lead: { table: "Lead", column: "name" },
  quotation: { table: "Quotation", column: "customerName" },
  proposal: { table: "Proposal", column: "customerName" },
  payment: { table: "Payment", column: "payerName" },
} as const;

export type FuzzyKind = keyof typeof TARGETS;
export type Fuzzy = Partial<Record<FuzzyKind, string[]>>;

/** Ids of the tenant's rows whose name is close to `q`, best match first, for each kind asked for. */
export async function fuzzyMatches(tenantId: string, q: string | undefined, kinds: FuzzyKind[]): Promise<Fuzzy> {
  const term = q?.trim();
  if (!term || term.length < FUZZY_MIN_LENGTH) return {};
  const found = await Promise.all(kinds.map(async (kind) => {
    const { table, column } = TARGETS[kind];
    // `<%` uses the trigram index and the threshold set for this transaction; ordering is by the same similarity.
    const [, rows] = await prisma.$transaction([
      prisma.$executeRawUnsafe(`SELECT set_config('pg_trgm.word_similarity_threshold', '${FUZZY_THRESHOLD}', true)`),
      prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "id" FROM "${table}" WHERE "tenantId" = $1 AND $2 <% "${column}" ORDER BY word_similarity($2, "${column}") DESC LIMIT ${FUZZY_LIMIT}`,
        tenantId, term,
      ),
    ]);
    return [kind, rows.map((r) => r.id)] as const;
  }));
  return Object.fromEntries(found);
}

/**
 * Name match for a search box. From 3 letters: the text anywhere in the name. One or two letters: names (or any word
 * of a name) that START with it – "a" gives Arun and Mary Ann, not every name with an "a" in it.
 */
export function nameLike<K extends string>(field: K, q: string): { [P in K]: Prisma.StringFilter }[] {
  const f = (filter: Prisma.StringFilter) => ({ [field]: { mode: "insensitive", ...filter } }) as { [P in K]: Prisma.StringFilter };
  return q.length >= FUZZY_MIN_LENGTH ? [f({ contains: q })] : [f({ startsWith: q }), f({ contains: ` ${q}` })];
}

/** Match for a number (mobile, lead / quote / proposal / policy no.): anywhere from 3 characters, nothing for fewer – one character matches far too much. */
export function numberLike<K extends string>(field: K, q: string, insensitive = true): { [P in K]: Prisma.StringFilter }[] {
  if (q.length < FUZZY_MIN_LENGTH) return [];
  return [{ [field]: { contains: q, ...(insensitive && { mode: "insensitive" }) } } as { [P in K]: Prisma.StringFilter }];
}
