import { describe, expect, it } from "vitest";
import { addMonths, compactPeso, dateParam, monthParam, monthlySummary, monthsBetween, niceAxis, portfolioRates, reportData } from "./report-utils";

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

describe("Trends & analytics months and chart (TA, Nov 14)", () => {
  it("reads only real YYYY-MM months from the address", () => {
    expect(monthParam("2026-11")).toBe("2026-11");
    expect(monthParam("2026-13")).toBeUndefined();
    expect(monthParam("2026-1")).toBeUndefined();
    expect(monthParam(undefined)).toBeUndefined();
  });
  it("moves across years and lists every month in between", () => {
    expect(addMonths("2026-11", -11)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(monthsBetween("2025-12", "2026-02")).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(monthsBetween("2026-03", "2026-02")).toEqual([]);
  });
  it("rounds the money axis to an easy number with at most 4 steps", () => {
    expect(niceAxis(3_620_000)).toEqual({ top: 4_000_000, step: 1_000_000 });
    expect(niceAxis(950_000)).toEqual({ top: 1_000_000, step: 250_000 });
    expect(niceAxis(0)).toEqual({ top: 4, step: 1 });
    const a = niceAxis(123_456);
    expect(a.top).toBeGreaterThanOrEqual(123_456);
    expect(a.top / a.step).toBeLessThanOrEqual(4);
  });
  it("writes short peso amounts for the chart", () => {
    expect(compactPeso(3_812_000)).toBe("₱3.8M");
    expect(compactPeso(3_000_000)).toBe("₱3M");
    expect(compactPeso(950_000)).toBe("₱950K");
    expect(compactPeso(0)).toBe("₱0");
  });
  it("keeps months with no loans in the average and leaves the month to date out of it", () => {
    const s = monthlySummary(
      [
        { month: "2026-08", count: 10, totalPrincipal: 100_000 },
        { month: "2026-09", count: 0, totalPrincipal: 0 }, // a quiet month still counts
        { month: "2026-10", count: 20, totalPrincipal: 200_000 },
        { month: "2026-11", count: 5, totalPrincipal: 50_000 }, // this month, not over yet
      ],
      "2026-11",
    );
    expect(s).toMatchObject({ count: 35, principal: 350_000, fullMonths: 3, emptyMonths: 1, averagePerFullMonth: 100_000, hasMonthToDate: true });
    expect(monthlySummary([{ month: "2026-11", count: 1, totalPrincipal: 5 }], "2026-11").averagePerFullMonth).toBeNull();
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
