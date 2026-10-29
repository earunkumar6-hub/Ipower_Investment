import { describe, expect, it } from "vitest";
import { addMonths } from "@/lib/dates";
import { priceItem, priceQuotation } from "@/lib/quotation";
import { renewalDueDates } from "@/lib/renewals";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (xs: Date[]) => xs.map((x) => x.toISOString().slice(0, 10));

describe("Quotation pricing", () => {
  it("adds no GST: total = premium, totalled on the server", () => {
    expect(priceItem("10500").total.toFixed(2)).toBe("10500.00");
    const q = priceQuotation(["18983", "10500"]);
    expect([q.subtotal, q.total].map((x) => x.toFixed(2))).toEqual(["29483.00", "29483.00"]);
  });

  it("rounds premiums to paise", () => {
    expect(priceItem("0.255").total.toFixed(2)).toBe("0.26");
  });
});

describe("Renewal schedule", () => {
  it("yearly policy → next year's due date", () => {
    expect(iso(renewalDueDates(d("2026-10-12"), "Yearly"))).toEqual(["2027-10-12"]);
  });
  it("monthly → 12 instalments, capped by term", () => {
    expect(renewalDueDates(d("2026-10-12"), "Monthly")).toHaveLength(12);
    expect(iso(renewalDueDates(d("2026-10-12"), "Monthly", 2))).toEqual(["2026-11-12", "2026-12-12"]);
  });
  it("one-time deposits have no renewals", () => {
    expect(renewalDueDates(d("2026-10-12"), "OneTime")).toEqual([]);
  });
  it("clamps to month end", () => {
    expect(iso([addMonths(d("2027-01-31"), 1), addMonths(d("2028-01-31"), 1)])).toEqual(["2027-02-28", "2028-02-29"]);
  });
});
