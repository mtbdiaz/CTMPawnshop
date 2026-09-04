import { describe, it, expect } from "vitest";
import {
  computeRedemptionRate,
  computeForfeitureRate,
  computeAverageLoanSize,
  computeMonthlyVolume,
  type LoanRecord,
} from "./analytics";

const loans: LoanRecord[] = [
  { principal_amount: 1000, status: "redeemed", loan_date: "2026-01-05" },
  { principal_amount: 2000, status: "redeemed", loan_date: "2026-01-20" },
  { principal_amount: 1500, status: "defaulted", loan_date: "2026-02-01" },
  { principal_amount: 500, status: "active", loan_date: "2026-02-10" },
];

describe("computeRedemptionRate (PB-39)", () => {
  it("computes redeemed / concluded, ignoring still-active loans", () => {
    expect(computeRedemptionRate(loans)).toBeCloseTo(2 / 3, 4);
  });

  it("is 0 when nothing has concluded", () => {
    expect(computeRedemptionRate([{ principal_amount: 1, status: "active", loan_date: "2026-01-01" }])).toBe(0);
  });
});

describe("computeForfeitureRate (PB-39)", () => {
  it("is the complement of redemption rate among concluded loans", () => {
    expect(computeForfeitureRate(loans)).toBeCloseTo(1 / 3, 4);
  });
});

describe("computeAverageLoanSize (PB-39)", () => {
  it("averages principal across all loans regardless of status", () => {
    expect(computeAverageLoanSize(loans)).toBe((1000 + 2000 + 1500 + 500) / 4);
  });

  it("is 0 for no loans", () => {
    expect(computeAverageLoanSize([])).toBe(0);
  });
});

describe("computeMonthlyVolume (PB-39)", () => {
  it("groups by month and sums principal, sorted chronologically", () => {
    const result = computeMonthlyVolume(loans);
    expect(result).toEqual([
      { month: "2026-01", count: 2, totalPrincipal: 3000 },
      { month: "2026-02", count: 2, totalPrincipal: 2000 },
    ]);
  });
});
