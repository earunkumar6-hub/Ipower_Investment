import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";

// Change log: one row per change, written in the same transaction as the change itself.

export type AuditInput = {
  entity: string;
  entityId: string;
  action: string;
  summary: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
};

/** Keeps only the keys whose values differ, so the log shows what actually changed. */
export function changedOnly(before: Record<string, unknown>, after: Record<string, unknown>) {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const keys = Object.keys(after).filter((k) => !same(before[k], after[k]));
  return {
    before: Object.fromEntries(keys.map((k) => [k, before[k] ?? null])),
    after: Object.fromEntries(keys.map((k) => [k, after[k] ?? null])),
  };
}

export function audit(tx: Tx, user: { id: string; tenantId: string }, a: AuditInput) {
  return tx.auditLog.create({
    data: {
      tenantId: user.tenantId,
      userId: user.id,
      entity: a.entity,
      entityId: a.entityId,
      action: a.action,
      summary: a.summary,
      before: (a.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (a.after ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: a.reason ?? undefined,
    },
  });
}
