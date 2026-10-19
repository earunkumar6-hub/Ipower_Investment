// Integration tests against the seeded demo database. Each test rolls back its changes.
import { afterAll, describe, expect, it } from "vitest";
import { poCommission } from "@/lib/commission";
import { accountDay, DayClosedError, earliestOpenDayBefore, post, reverseSource } from "@/lib/daybook";
import { addDays, istToday } from "@/lib/dates";
import { db, prisma, type Tx } from "@/lib/db";
import { fmtINR } from "@/lib/money";
import { nextNumber } from "@/lib/numbering";

class Rollback extends Error {}
async function inRollback(fn: (tx: Tx) => Promise<void>) {
  await expect(
    db.$transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

const today = istToday();
const yesterday = addDays(today, -1);

async function ctx() {
  const tenant = await prisma.tenant.findFirstOrThrow();
  const cash = await prisma.account.findFirstOrThrow({ where: { tenantId: tenant.id, type: "Cash" } });
  const user = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  return { tenantId: tenant.id, cashId: cash.id, userId: user.id };
}

const line = (accountId: string, amount = "100.00") => ({
  key: "in", accountId, direction: "In" as const, amount, entryType: "Collection" as const, mode: "Cash" as const, particulars: "test",
});

afterAll(() => prisma.$disconnect());

describe("Day Book posting", () => {
  it("posts once per source even when the event is replayed", async () => {
    const { tenantId, cashId, userId } = await ctx();
    await inRollback(async (tx) => {
      const input = { tenantId, entryDate: today, sourceType: "Manual" as const, sourceId: "t-idem", createdById: userId, lines: [line(cashId)] };
      const first = await post(tx, input);
      const second = await post(tx, input);
      expect(first).toHaveLength(1);
      expect(second.map((e) => e.id)).toEqual(first.map((e) => e.id));
      expect(await tx.dayBookEntry.count({ where: { sourceId: "t-idem" } })).toBe(1);
    });
  });

  it("refuses to post into a closed day", async () => {
    const { tenantId, cashId, userId } = await ctx();
    await inRollback(async (tx) => {
      await expect(
        post(tx, { tenantId, entryDate: yesterday, sourceType: "Manual", sourceId: "t-closed", createdById: userId, lines: [line(cashId)] }),
      ).rejects.toBeInstanceOf(DayClosedError);
    });
  });

  it("never updates or deletes an entry", async () => {
    const entry = await prisma.dayBookEntry.findFirstOrThrow({ where: { entryDate: yesterday } });
    await expect(db.dayBookEntry.update({ where: { id: entry.id }, data: { amount: 1 } })).rejects.toThrow(/immutable/);
    await expect(db.dayBookEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/immutable/);
    await expect(db.dayBookEntry.deleteMany({ where: { id: entry.id } })).rejects.toThrow(/immutable/);
    // Feature code runs inside transactions: the guard must hold there too.
    await inRollback(async (tx) => {
      await expect(tx.dayBookEntry.update({ where: { id: entry.id }, data: { amount: 1 } })).rejects.toThrow(/immutable/);
      await expect(tx.dayBookEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/immutable/);
    });
  });

  it("corrects by reversal dated today, leaving the closed day untouched", async () => {
    const { tenantId, userId } = await ctx();
    const closedEntry = await prisma.dayBookEntry.findFirstOrThrow({ where: { entryDate: yesterday, sourceType: "Receipt" } });
    await inRollback(async (tx) => {
      const before = await accountDay(tx, tenantId, yesterday);
      const rev = await reverseSource(tx, {
        tenantId, sourceType: "Receipt", sourceId: closedEntry.sourceId!, entryDate: today, createdById: userId, reason: "test",
      });
      expect(rev).toHaveLength(1);
      expect(rev[0].direction).toBe(closedEntry.direction === "In" ? "Out" : "In");
      expect(rev[0].amount.equals(closedEntry.amount)).toBe(true);
      expect(rev[0].entryDate).toEqual(today);
      expect(await accountDay(tx, tenantId, yesterday)).toEqual(before);
      const again = await reverseSource(tx, {
        tenantId, sourceType: "Receipt", sourceId: closedEntry.sourceId!, entryDate: today, createdById: userId, reason: "test",
      });
      expect(again).toHaveLength(0);
    });
  });
});

describe("Day Book balances (seed)", () => {
  it("opens today at yesterday's verified closing for every account", async () => {
    const { tenantId } = await ctx();
    const rows = await accountDay(db as unknown as Tx, tenantId, today);
    const closes = await prisma.dayClose.findMany({ where: { tenantId, date: yesterday, status: "Closed" } });
    expect(closes).toHaveLength(rows.length);
    for (const r of rows) {
      const c = closes.find((x) => x.accountId === r.accountId)!;
      expect(r.opening.toFixed(2)).toBe(c.computed.toFixed(2));
    }
    const opening = Object.fromEntries(rows.map((r) => [r.name, r.opening.toFixed(2)]));
    expect(opening).toEqual({
      Cash: "12000.00", "SBI current ••1234": "150000.00", "EB wallet": "10110.00", "PAN wallet": "2000.00", "Certificate wallet": "1296.00",
    });
  });

  it("has no earlier day left open", async () => {
    const { tenantId } = await ctx();
    expect(await earliestOpenDayBefore(db as unknown as Tx, tenantId, today)).toBeNull();
  });
});

describe("Post office commission", () => {
  it("matches the spec examples", () => {
    const rd = poCommission("PoRd", "1000");
    expect([rd.gross, rd.tds, rd.net].map((d) => d.toFixed(2))).toEqual(["4.00", "0.08", "3.92"]);
    const td = poCommission("PoTd", "100000");
    expect([td.gross, td.tds, td.net].map((d) => d.toFixed(2))).toEqual(["500.00", "10.00", "490.00"]);
  });
});

describe("Money format", () => {
  it("uses Indian grouping and shows paise only when present", () => {
    expect(fmtINR("110500")).toBe("₹1,10,500");
    expect(fmtINR("860.5")).toBe("₹860.50");
    expect(fmtINR("3.92")).toBe("₹3.92");
  });
});

describe("Numbering", () => {
  it("continues each series per tenant", async () => {
    const { tenantId, userId } = await ctx();
    await inRollback(async (tx) => {
      const first = await nextNumber(tx, tenantId, "lead");
      expect(first).toMatch(/^L-\d{4}$/);
      await tx.lead.create({ data: { tenantId, leadNo: first, name: "Test", firstName: "Test", mobile: "9000000001", source: "Direct", ownerId: userId } });
      const second = await nextNumber(tx, tenantId, "lead");
      expect(Number(second.slice(2))).toBe(Number(first.slice(2)) + 1);
      expect(await nextNumber(tx, tenantId, "proposal")).toMatch(/^P-\d{4}$/);
    });
  });
});
