import { describe, expect, it } from "vitest";
import { priceService, RateNotConfiguredError, type RateRow } from "@/lib/esevai";
import { D } from "@/lib/money";

const from = new Date("2026-04-01T00:00:00Z");
const slab = (min: string, max: string, charge: string): RateRow => ({
  minAmount: new D(min), maxAmount: new D(max), serviceCharge: new D(charge), walletCost: null, fixedCustomerAmount: null, effectiveFrom: from,
});
const fixed = (customer: string, cost: string): RateRow => ({
  minAmount: null, maxAmount: null, serviceCharge: null, walletCost: new D(cost), fixedCustomerAmount: new D(customer), effectiveFrom: from,
});
const EB = [slab("0.01", "999.99", "10.00"), slab("2000.00", "29999.99", "20.00")];
const fmt = (p: ReturnType<typeof priceService>) =>
  [p.customerAmount, p.walletCost, p.profit].map((d) => d.toFixed(2));

describe("E-Sevai rate engine", () => {
  it("EB slabs: ₹850 → collect ₹860, wallet ₹850, profit ₹10", () => {
    expect(fmt(priceService("EB", EB, "850"))).toEqual(["860.00", "850.00", "10.00"]);
    expect(fmt(priceService("EB", EB, "2450"))).toEqual(["2470.00", "2450.00", "20.00"]);
    expect(fmt(priceService("EB", EB, "29999.99"))).toEqual(["30019.99", "29999.99", "20.00"]);
  });

  it("EB gaps are refused (open decision)", () => {
    for (const amount of ["1000", "1500", "1999.99", "30000"]) {
      expect(() => priceService("EB", EB, amount)).toThrow(RateNotConfiguredError);
    }
  });

  it("fixed services: PAN 200/100, certificate 100/12", () => {
    expect(fmt(priceService("PAN", [fixed("200.00", "100.00")], 0))).toEqual(["200.00", "100.00", "100.00"]);
    expect(fmt(priceService("CERT", [fixed("100.00", "12.00")], 0))).toEqual(["100.00", "12.00", "88.00"]);
  });
});
