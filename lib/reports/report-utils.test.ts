import { describe, expect, it } from "vitest";
import { dateParam, portfolioRates, reportData } from "./report-utils";

// RP9: the counting, paging and paid / overdue / age rules moved into the database (migration 0066) and are
// tested there by ctm_selftest_0066 (including 10,000 extra test loans, rolled back). These tests cover what
// is still worked out in TypeScript.

describe("portfolioRates (PB-39, from the counts per status)", () => {
  it("counts only concluded loans in the two rates", () => {
    const r = portfolioRates({ active: 50, extended: 10, redeemed: 30, defaulted: 6, forfeited: 4 }, 100, 250000);
    expect(r.concluded).toBe(40);
    expect(r.running).toBe(60);
    expect(r.redemptionRate).toBe(0.75); // 30 of 40
    expect(r.forfeitureRate).toBe(0.25); // (6 + 4) of 40
    expect(r.redemptionRate + r.forfeitureRate).toBe(1); // the two rates always add up to 100%
    expect(r.averageLoan).toBe(2500);
  });
  it("gives 0 instead of dividing by zero", () => {
    expect(portfolioRates({ active: 3 }, 3, 900)).toMatchObject({ concluded: 0, redemptionRate: 0, forfeitureRate: 0, averageLoan: 300 });
    expect(portfolioRates({}, 0, 0)).toMatchObject({ running: 0, averageLoan: 0 });
  });
});

describe("dates in the address", () => {
  it("accepts only real dates", () => {
    expect(dateParam("2026-11-12")).toBe("2026-11-12");
    expect(dateParam("2026-02-31")).toBeUndefined();
    expect(dateParam("11/12/2026")).toBeUndefined();
    expect(dateParam(undefined)).toBeUndefined();
  });
});

describe("reportData", () => {
  it("returns the data, or throws the database's message", () => {
    expect(reportData<{ a: number }>({ data: { a: 1 }, error: null })).toEqual({ a: 1 });
    expect(() => reportData({ data: null, error: { message: "Not allowed" } })).toThrow("Not allowed");
  });
});
