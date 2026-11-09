import { describe, expect, it } from "vitest";
import { appraisalNo, customerNo, parseRefNo } from "./ref-numbers";

describe("short numbers (#18, #29)", () => {
  it("formats with the letter and at least 4 digits", () => {
    expect(customerNo(12)).toBe("C-0012");
    expect(appraisalNo(1308)).toBe("A-1308");
    expect(customerNo(12345)).toBe("C-12345");
    expect(customerNo(null)).toBe("");
  });
  it("reads what staff type", () => {
    expect(parseRefNo("C-0012")).toEqual({ kind: "C", n: 12 });
    expect(parseRefNo("c12")).toEqual({ kind: "C", n: 12 });
    expect(parseRefNo(" a 45 ")).toEqual({ kind: "A", n: 45 });
  });
  it("leaves names, phones and tickets to the normal search", () => {
    expect(parseRefNo("Carlo")).toBeNull();
    expect(parseRefNo("09171234567")).toBeNull();
    expect(parseRefNo("PT-2026")).toBeNull();
    expect(parseRefNo("C-0")).toBeNull();
  });
});
