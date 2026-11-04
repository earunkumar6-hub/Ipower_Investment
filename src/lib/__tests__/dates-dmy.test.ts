import { describe, expect, it } from "vitest";
import { dmyToIso, fmtDmy, isoToDmy } from "@/lib/dates";

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
