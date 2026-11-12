// Renewals filter (product → company → scheme) and post office maturity reminders, on the seeded demo data.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { istToday } from "@/lib/dates";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/session";

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

const { loadRenewals, renewalFilterOptions } = await import("@/lib/renewals");
const { markMatured } = await import("@/app/(app)/renewals/actions");
let admin: U;
const today = istToday();
const numbers = (rows: { policy: { policyNumber: string } }[]) => rows.map((r) => r.policy.policyNumber);

beforeAll(async () => {
  const u = await prisma.user.findFirstOrThrow({ where: { username: "admin" } });
  admin = { id: u.id, name: u.name, username: "admin", role: u.role, tenantId: u.tenantId };
});

afterAll(async () => {
  await prisma.policy.updateMany({ where: { policyNumber: "MIS 8840-31" }, data: { status: "Active" } });
  await prisma.$disconnect();
});

describe("Renewals filter", () => {
  it("insurance company and scheme narrow every tab", async () => {
    const u = admin as SessionUser;
    for (const tab of ["due", "overdue", "paid"]) {
      const all = await loadRenewals(u, { tab, product: "insurance" }, today);
      const sbi = await loadRenewals(u, { tab, product: "insurance", company: "SBI Life" }, today);
      const plan = await loadRenewals(u, { tab, product: "insurance", company: "SBI Life", scheme: "Smart Shield" }, today);
      expect(all.rows.every((r) => r.policy.productType === "Insurance")).toBe(true);
      expect(sbi.rows.every((r) => r.policy.partner === "SBI Life")).toBe(true);
      expect(plan.rows.every((r) => r.policy.productName === "Smart Shield")).toBe(true);
      expect(sbi.rows.length).toBeLessThanOrEqual(all.rows.length);
    }
    expect(numbers((await loadRenewals(u, { tab: "due", product: "insurance", company: "SBI Life", scheme: "Smart Shield" }, today)).rows)).toContain("SBIL-7745120");
  });

  it("offers companies and schemes from the policies on file", async () => {
    const ins = await renewalFilterOptions(admin as SessionUser, "insurance", "Star Health");
    expect(ins.companies).toEqual(expect.arrayContaining(["SBI Life", "Star Health", "Care Health", "LIC"]));
    expect(ins.schemes.map(([s]) => s)).toEqual(expect.arrayContaining(["Comprehensive", "Family Health Optima"]));
    expect(ins.schemes.map(([s]) => s)).not.toContain("Smart Shield");
    const po = await renewalFilterOptions(admin as SessionUser, "po");
    expect(po.schemes.map(([, l]) => l)).toEqual(["RD", "TD", "MIS", "SCSS", "SSA", "PPF", "NSC", "KVP"]);
  });

  it("post office: SSA/PPF yearly dues on Due / Overdue; SCSS/MIS maturities on their own tab, out of the total (#20)", async () => {
    const u = admin as SessionUser;
    const due = await loadRenewals(u, { tab: "due", product: "po" }, today);
    expect(numbers(due.rows)).toContain("SSA 5510-08");
    expect(due.rows.every((r) => r.kind === "instalment")).toBe(true);

    const overdue = await loadRenewals(u, { tab: "overdue", product: "po" }, today);
    expect(numbers(overdue.rows)).toContain("PPF 6620-14");
    expect(overdue.rows.every((r) => r.kind === "instalment")).toBe(true);
    expect(numbers((await loadRenewals(u, { tab: "overdue", product: "po", scheme: "PoPpf" }, today)).rows)).toEqual(["PPF 6620-14"]);
    expect((await loadRenewals(u, { tab: "paid", product: "po", scheme: "PoMis" }, today)).rows).toEqual([]);

    // Maturity: SCSS coming up within a month, MIS matured and not yet marked; nothing counts as money to collect.
    const maturity = await loadRenewals(u, { tab: "maturity", product: "po" }, today);
    expect(numbers(maturity.rows)).toEqual(expect.arrayContaining(["SCSS 7730-02", "MIS 8840-31"]));
    expect(maturity.rows.every((r) => r.kind === "maturity")).toBe(true);
    expect(Number(maturity.total)).toBe(0);
    expect(numbers((await loadRenewals(u, { tab: "maturity", product: "po", scheme: "PoMis" }, today)).rows)).toEqual(["MIS 8840-31"]);
    expect((await loadRenewals(u, { tab: "maturity", product: "mf" }, today)).rows).toEqual([]);
  });

  it("a matured deposit can be marked matured once; one not yet matured cannot", async () => {
    session.user = admin;
    const mis = await prisma.policy.findFirstOrThrow({ where: { policyNumber: "MIS 8840-31" } });
    const scss = await prisma.policy.findFirstOrThrow({ where: { policyNumber: "SCSS 7730-02" } });
    expect(await markMatured(scss.id)).toEqual({ ok: false, error: "This deposit has not matured yet" });
    expect(await markMatured(mis.id)).toEqual({ ok: true });
    expect(await markMatured(mis.id)).toEqual({ ok: false, error: "This deposit is no longer active" });
    expect(numbers((await loadRenewals(admin as SessionUser, { tab: "overdue", product: "po" }, today)).rows)).not.toContain("MIS 8840-31");
  });
});
