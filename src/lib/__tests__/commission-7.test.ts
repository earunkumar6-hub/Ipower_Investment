// Change set phase 7 – Commission received (#18), Super Admin only. Rows it creates are removed afterwards.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { commissionSummary, fyMonths, fyOfMonth } from "@/lib/commission-received";
import { balanceAt } from "@/lib/daybook";
import { istToday } from "@/lib/dates";
import { db, prisma, type Tx } from "@/lib/db";
import { MENU } from "@/lib/menu";
import { hasPermission } from "@/lib/permissions";
import { monthKey, monthRange, profitAndLoss } from "@/lib/pnl";

type U = { id: string; name: string; username: string; role: "Admin" | "User" | "SuperAdmin"; tenantId: string };
const session = vi.hoisted(() => ({ user: null as null | U }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", async () => {
  const { hasPermission } = await import("@/lib/permissions");
  return {
    authorize: async (permission: Parameters<typeof hasPermission>[1]) => {
      if (!session.user) throw new Error("Not signed in");
      if (!hasPermission(session.user.role, permission)) throw new Error(`Not allowed: ${permission}`);
      return session.user;
    },
  };
});

const { recordCommission, cancelCommission } = await import("@/app/(app)/commission/actions");
const { REPORTS } = await import("@/lib/exports");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const users: Record<string, U> = {};
const as = (u: string) => (session.user = users[u]);
const started = new Date();
const today = istToday();
const month = monthKey(today);
let bank = "", cash = "";
const entry = (o: Record<string, string> = {}) =>
  form({ source: "LIC", otherSource: "", forMonth: month, amount: "4500", accountId: bank, reference: "VT7-UTR", receivedOn: today.toISOString().slice(0, 10), note: "", ...o });

beforeAll(async () => {
  for (const username of ["arun", "admin", "superadmin"]) {
    const u = await prisma.user.findFirstOrThrow({ where: { username } });
    users[username] = { id: u.id, name: u.name, username, role: u.role, tenantId: u.tenantId };
  }
  bank = (await prisma.account.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, type: "Bank", isDefault: true } })).id;
  cash = (await prisma.account.findFirstOrThrow({ where: { tenantId: users.admin.tenantId, type: "Cash" } })).id;
});

afterAll(async () => {
  const ids = (await prisma.commissionReceipt.findMany({ where: { createdAt: { gte: started } }, select: { id: true } })).map((r) => r.id);
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.commissionReceipt.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("Super Admin only", () => {
  it("permission, menu and export are the owner's only", () => {
    expect(hasPermission("SuperAdmin", "Commission.View")).toBe(true);
    expect(hasPermission("Admin", "Commission.View")).toBe(false);
    expect(hasPermission("User", "Commission.View")).toBe(false);
    expect(MENU.find((m) => m.href === "/commission")).toBeUndefined(); // hidden from the menu for now (owner, 23 Oct 2026)
    expect(REPORTS.commission.permission).toBe("Commission.View");
  });

  it("Admins and Users can't record or cancel", async () => {
    for (const u of ["arun", "admin"]) {
      as(u);
      await expect(recordCommission({ ok: false }, entry())).rejects.toThrow(/Not allowed/);
      await expect(cancelCommission({ ok: false }, form({ id: "x", reason: "test" }))).rejects.toThrow(/Not allowed/);
    }
  });
});

describe("Recording commission", () => {
  it("needs the UTR, a bank account, a past or current month and date; Other needs its name", async () => {
    as("superadmin");
    expect((await recordCommission({ ok: false }, entry({ reference: "" }))).fieldErrors).toHaveProperty("reference");
    expect((await recordCommission({ ok: false }, entry({ accountId: cash }))).fieldErrors).toHaveProperty("accountId");
    expect((await recordCommission({ ok: false }, entry({ forMonth: "2099-01" }))).fieldErrors).toHaveProperty("forMonth");
    expect((await recordCommission({ ok: false }, entry({ receivedOn: "2099-01-01" }))).fieldErrors).toHaveProperty("receivedOn");
    expect((await recordCommission({ ok: false }, entry({ source: "Other" }))).fieldErrors).toHaveProperty("otherSource");
  });

  it("saved in the owner's ledger only: no Day Book line, bank balance unchanged; counted in P&L for its month; cancel takes it out", async () => {
    as("superadmin");
    const range = monthRange(month);
    const before = await profitAndLoss(users.admin.tenantId, range);
    const bankBefore = await balanceAt(db as unknown as Tx, bank, today);

    const r = await recordCommission({ ok: false }, entry());
    expect(r.ok).toBe(true);
    const other = await recordCommission({ ok: false }, entry({ source: "Other", otherSource: "Bajaj Allianz", amount: "500" }));
    expect(other.ok).toBe(true);
    expect(await prisma.dayBookEntry.count({ where: { createdAt: { gte: started } } })).toBe(0);
    expect((await balanceAt(db as unknown as Tx, bank, today)).toFixed(2)).toBe(bankBefore.toFixed(2));
    expect(await prisma.auditLog.count({ where: { entity: "CommissionReceipt", entityId: r.id! } })).toBe(1);

    const after = await profitAndLoss(users.admin.tenantId, range);
    expect(after.commission.minus(before.commission).toFixed(2)).toBe("5000.00");
    expect(after.profit.minus(before.profit).toFixed(2)).toBe("5000.00");

    const s = await commissionSummary(users.admin.tenantId, month, fyOfMonth(month));
    expect(s.cards.entriesThisMonth).toBeGreaterThanOrEqual(2);
    expect(s.byMonth.find((m) => m.month === month)!.amount.gte(5000)).toBe(true);
    expect(s.entries.map((e) => e.source)).toContain("Bajaj Allianz");

    expect((await cancelCommission({ ok: false }, form({ id: other.id!, reason: "" }))).ok).toBe(false);
    expect(await cancelCommission({ ok: false }, form({ id: other.id!, reason: "Entered twice" }))).toEqual({ ok: true });
    expect((await cancelCommission({ ok: false }, form({ id: other.id!, reason: "again" }))).ok).toBe(false);
    const final = await profitAndLoss(users.admin.tenantId, range);
    expect(final.commission.minus(before.commission).toFixed(2)).toBe("4500.00");
  });
});

describe("Financial year helpers", () => {
  it("April–March", () => {
    expect(fyOfMonth("2026-03")).toBe("2025-26");
    expect(fyOfMonth("2026-04")).toBe("2026-27");
    expect(fyMonths("2026-27")[0]).toBe("2026-04");
    expect(fyMonths("2026-27")[11]).toBe("2027-03");
  });
});
