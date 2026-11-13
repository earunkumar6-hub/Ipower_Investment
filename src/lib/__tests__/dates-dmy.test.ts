import { describe, expect, it } from "vitest";
import { dmyToIso, fmtDayMon, fmtDmy, istDate, isoToDmy } from "@/lib/dates";

describe("25 Oct 2026 dates (Renewals download)", () => {
  it("prints day, short month and year", () => {
    expect(fmtDayMon(new Date("2026-10-25T00:00:00Z"))).toBe("25 Oct 2026");
    expect(fmtDayMon(new Date("2026-01-05T00:00:00Z"))).toBe("05 Jan 2026");
    // A reminder sent at 11 pm IST on 25 Oct is 25 Oct, not the UTC day.
    expect(fmtDayMon(istDate(new Date("2026-10-25T17:45:00Z")))).toBe("25 Oct 2026");
  });
});

describe("dd/mm/yyyy dates (lead date of birth)", () => {
  it("converts both ways", () => {
    expect(dmyToIso("12/03/1985")).toBe("1985-03-12");
    expect(isoToDmy("1985-03-12")).toBe("12/03/1985");
    expect(fmtDmy(new Date("1985-03-12T00:00:00Z"))).toBe("12/03/1985");
  });

  it("refuses dates that don't exist or aren't complete", () => {
    expect(dmyToIso("31/02/1990")).toBe("");
    expect(dmyToIso("29/02/2023")).toBe("");
    expect(dmyToIso("29/02/2024")).toBe("2024-02-29");
    expect(dmyToIso("12/3/1985")).toBe("");
    expect(dmyToIso("12/13/1985")).toBe("");
    expect(isoToDmy("")).toBe("");
  });
});
