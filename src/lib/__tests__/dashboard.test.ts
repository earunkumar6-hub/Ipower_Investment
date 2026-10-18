import { afterAll, describe, expect, it } from "vitest";
import { collectionsByStaff, ownerPies } from "@/lib/dashboard";
import { istToday } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { monthKey, monthRange } from "@/lib/pnl";

const seedFitsInMonth = istToday().getUTCDate() >= 10;
afterAll(() => prisma.$disconnect());

async function owner() {
  const u = await prisma.user.findFirstOrThrow({ where: { username: "superadmin" } });
  return { id: u.id, name: u.name, username: "superadmin", role: u.role, tenantId: u.tenantId };
}

describe.runIf(seedFitsInMonth)("Dashboard pies (seeded month)", () => {
  it("income by vertical and expenses by category match P&L", async () => {
    const pies = await ownerPies(await owner());
    const income = Object.fromEntries(pies.income.map((s) => [s.label, s.value]));
    expect(income["Insurance commission"]).toBe(62300); // SBI Life + Star Health + Care Health statements
    expect(income["Mutual fund commission"]).toBe(7700); // HDFC MF
    expect(income["E-Sevai service charges"]).toBe(1138);
    expect(income["Post office commission"]).toBeUndefined(); // not business income
    expect(income["Other commission"]).toBeUndefined(); // zero slices are dropped
    expect(Object.fromEntries(pies.expenses.map((s) => [s.label, s.value]))).toEqual({ Rent: 25000, Utilities: 4280, Office: 450, Travel: 350 });
    expect(pies.income.length).toBeLessThanOrEqual(6);
  });

  it("collections by staff add up to all receipts and E-Sevai collected this month", async () => {
    const u = await owner();
    const { slices } = await collectionsByStaff(u);
    const range = monthRange(monthKey(istToday()));
    const [r, s] = await Promise.all([
      prisma.receipt.aggregate({ where: { tenantId: u.tenantId, status: "Saved", receiptDate: { gte: range.from, lt: range.to } }, _sum: { amount: true } }),
      prisma.serviceTransaction.aggregate({ where: { tenantId: u.tenantId, status: "Saved", txnDate: { gte: range.from, lt: range.to } }, _sum: { customerAmount: true } }),
    ]);
    const total = slices.reduce((t, x) => t + x.value, 0);
    expect(total).toBeCloseTo(Number(r._sum.amount) + Number(s._sum.customerAmount), 2);
    expect(slices.map((x) => x.label)).not.toContain("Owner"); // nobody with zero collections
  });
});
