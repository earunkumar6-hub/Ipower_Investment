import type { Tx } from "@/lib/db";

// "Someone is editing this customer" ticket (QA D-02, owner 13 Nov 2026).
// First person to open Edit details takes a 5-minute ticket; the open box renews it every minute; Save, Cancel and
// closing release it; a crashed PC's ticket simply expires. Everyone else sees who is editing and cannot save.
// A ticket is one row per customer, taken in ONE atomic statement, so two people opening at the same instant cannot
// both get it – and nobody ever waits for a ticket, so nothing can deadlock. The version check in editCustomer stays
// underneath as a safety net (an expired ticket whose owner comes back and saves).

export const EDIT_LOCK_MINUTES = 5;

export type LockResult = { ok: true } | { ok: false; holder: string; since: Date };

/** Takes (or renews) the ticket for `userId`. Fails when another person holds a ticket that has not expired. */
export async function acquireEditLock(tx: Pick<Tx, "$queryRaw">, tenantId: string, customerId: string, userId: string): Promise<LockResult> {
  const got = await tx.$queryRaw<{ userId: string }[]>`
    INSERT INTO "CustomerEditLock" ("customerId", "tenantId", "userId", "acquiredAt", "expiresAt")
    VALUES (${customerId}, ${tenantId}, ${userId}, now(), now() + ${EDIT_LOCK_MINUTES}::int * interval '1 minute')
    ON CONFLICT ("customerId") DO UPDATE SET
      "acquiredAt" = CASE WHEN "CustomerEditLock"."userId" = EXCLUDED."userId" THEN "CustomerEditLock"."acquiredAt" ELSE now() END,
      "userId" = EXCLUDED."userId",
      "expiresAt" = EXCLUDED."expiresAt"
    WHERE "CustomerEditLock"."expiresAt" < now() OR "CustomerEditLock"."userId" = EXCLUDED."userId"
    RETURNING "userId"`;
  if (got.length) return { ok: true };
  const holder = await editLockHolder(tx, customerId, userId);
  // The ticket may have been released between the two statements: try once more.
  return holder ? { ok: false, ...holder } : acquireEditLock(tx, tenantId, customerId, userId);
}

/** Who holds a live ticket on this customer, other than `me` (null when nobody does). */
export async function editLockHolder(tx: Pick<Tx, "$queryRaw">, customerId: string, me: string) {
  const rows = await tx.$queryRaw<{ holder: string; since: Date }[]>`
    SELECT u."name" AS holder, l."acquiredAt" AS since
    FROM "CustomerEditLock" l JOIN "User" u ON u."id" = l."userId"
    WHERE l."customerId" = ${customerId} AND l."userId" <> ${me} AND l."expiresAt" > now()`;
  return rows[0] ?? null;
}

export async function releaseEditLock(tx: Pick<Tx, "$executeRaw">, customerId: string, userId: string) {
  await tx.$executeRaw`DELETE FROM "CustomerEditLock" WHERE "customerId" = ${customerId} AND "userId" = ${userId}`;
}

/** Admin / Super Admin: the ticket goes to `userId` whoever held it. Returns the previous holder's name, if any. */
export async function takeOverEditLock(tx: Pick<Tx, "$queryRaw" | "$executeRaw">, tenantId: string, customerId: string, userId: string) {
  const previous = await editLockHolder(tx, customerId, userId);
  await tx.$executeRaw`DELETE FROM "CustomerEditLock" WHERE "customerId" = ${customerId}`;
  await acquireEditLock(tx, tenantId, customerId, userId);
  return previous?.holder ?? null;
}

export const editLockMessage = (holder: string, since: Date) =>
  `${holder} is editing this customer (since ${since.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })}). You can look, but not save until they finish.`;
