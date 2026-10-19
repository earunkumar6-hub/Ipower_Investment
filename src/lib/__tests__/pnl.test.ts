import { afterAll, describe, expect, it } from "vitest";
import { istToday } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { monthKey, monthRange, previousMonthKey, profitAndLoss } from "@/lib/pnl";

// The seed puts its history 1–9 days back, so the month figures are exact only from the 10th.
const seedFitsInMonth = istToday().getUTCDate() >= 10;

afterAll(() => prisma.$disconnect());

describe("Profit and Loss", () => {
  it("month helpers", () => {
    expect(previousMonthKey("2026-01")).toBe("2025-12");
    const r = monthRange("2026-10");
    expect([r.from.toISOString().slice(0, 10), r.to.toISOString().slice(0, 10), r.label]).toEqual(["2026-10-01", "2026-11-01", "October 2026"]);
  });

  it.runIf(seedFitsInMonth)("seeded month: service charges, other income, expenses (waiting ones excluded)", async () => {
    const tenant = await prisma.tenant.findFirstOrThrow();
    const p = await profitAndLoss(tenant.id, monthRange(monthKey(istToday())));
    expect(Object.fromEntries(p.serviceLines.map((l) => [l.label, l.amount.toFixed(2)]))).toEqual({
      "EB bill": "110.00", "PAN application": "500.00", Certificate: "528.00",
    });
    expect(p.serviceCharges.toFixed(2)).toBe("1138.00");
    // Commission is recorded but not counted (owner decision 19 Oct 2026); other income comes from the Day Book.
    expect(p.otherIncome.toFixed(2)).toBe("24000.00");
    expect(p.income.toFixed(2)).toBe("25138.00");
    // Rent 25,000 + electricity 3,100 + internet 1,180 + tea 450 + auto fare 350 (employee-paid still counts)
    expect(p.expenseTotal.toFixed(2)).toBe("30080.00");
    expect(p.expenseLines.find((l) => l.label === "Equipment")).toBeUndefined(); // laptop is waiting
    expect(p.profit.toFixed(2)).toBe(p.income.minus(p.expenseTotal).toFixed(2));
  });

  it.runIf(seedFitsInMonth)("an approved expense counts on its bill date even if not yet paid", async () => {
    const tenant = await prisma.tenant.findFirstOrThrow();
    const laptop = await prisma.expense.findFirstOrThrow({ where: { description: "Laptop" } });
    const range = monthRange(monthKey(istToday()));
    const before = await profitAndLoss(tenant.id, range);
    await prisma.expense.update({ where: { id: laptop.id }, data: { status: "Approved" } });
    try {
      const after = await profitAndLoss(tenant.id, range);
      expect(after.expenseTotal.minus(before.expenseTotal).toFixed(2)).toBe("38000.00");
      expect(after.expenseLines.find((l) => l.label === "Equipment")?.amount.toFixed(2)).toBe("38000.00");
    } finally {
      await prisma.expense.update({ where: { id: laptop.id }, data: { status: "Waiting" } });
    }
  });
});
