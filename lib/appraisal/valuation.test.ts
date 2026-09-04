import { describe, it, expect } from "vitest";
import { calculateValuation, isCounterfeitRisk } from "./valuation";

describe("calculateValuation (PB-14, placeholder formula)", () => {
  it("computes value = weight * purity% * gold price", () => {
    const result = calculateValuation({
      weightGrams: 10,
      purityPercent: 91.6,
      goldPricePerGram: 3500,
      ltvPercent: 70,
    });
    expect(result.value).toBeCloseTo(10 * 0.916 * 3500, 2);
  });

  it("computes suggested loan max as value * ltv%", () => {
    const result = calculateValuation({
      weightGrams: 10,
      purityPercent: 100,
      goldPricePerGram: 1000,
      ltvPercent: 70,
    });
    expect(result.suggestedLoanMax).toBeCloseTo(7000, 2);
    expect(result.suggestedLoanMin).toBeLessThan(result.suggestedLoanMax);
  });

  it("returns zero value for zero weight", () => {
    const result = calculateValuation({
      weightGrams: 0,
      purityPercent: 100,
      goldPricePerGram: 1000,
      ltvPercent: 70,
    });
    expect(result.value).toBe(0);
  });
});

describe("isCounterfeitRisk (PB-15)", () => {
  it("does not flag purity within the expected range for the karat", () => {
    expect(isCounterfeitRisk(18, 75)).toBe(false);
    expect(isCounterfeitRisk(24, 99.9)).toBe(false);
  });

  it("flags purity outside the expected range for the karat", () => {
    expect(isCounterfeitRisk(18, 50)).toBe(true);
    expect(isCounterfeitRisk(24, 60)).toBe(true);
  });

  it("flags an unrecognized karat claim for review", () => {
    expect(isCounterfeitRisk(17, 70)).toBe(true);
  });
});
