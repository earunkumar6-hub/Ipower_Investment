// QA D-07: an Aadhaar number is 12 digits, starts with 2-9 and ends in a correct Verhoeff check digit.
import { describe, expect, it } from "vitest";
import { isValidAadhaar, verhoeffValid } from "@/lib/identity";

describe("Aadhaar rule", () => {
  it("accepts numbers with a correct check digit", () => {
    for (const n of ["223456789018", "234567890124", "555566667771", "987654321012"]) expect(isValidAadhaar(n), n).toBe(true);
  });
  it("refuses a wrong last digit and swapped digits (typing mistakes)", () => {
    expect(isValidAadhaar("223456789019")).toBe(false); // wrong check digit
    expect(isValidAadhaar("223456789081")).toBe(false); // last two digits swapped
    expect(isValidAadhaar("232456789018")).toBe(false); // two digits swapped inside
  });
  it("refuses wrong length and a first digit of 0 or 1", () => {
    expect(isValidAadhaar("22345678901")).toBe(false);
    expect(isValidAadhaar("2234567890188")).toBe(false);
    expect(isValidAadhaar("123456789012")).toBe(false);
    expect(isValidAadhaar("012345678901")).toBe(false);
    expect(isValidAadhaar("22345678901a")).toBe(false);
  });
  it("Verhoeff on its own", () => {
    expect(verhoeffValid("2363")).toBe(true); // textbook example 236 + check digit 3
    expect(verhoeffValid("2364")).toBe(false);
  });
});
