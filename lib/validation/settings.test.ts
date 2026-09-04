import { describe, it, expect } from "vitest";
import { businessRulesSchema } from "./settings";

describe("businessRulesSchema (PB-6 AC2)", () => {
  const valid = {
    interest_rate_percent: "5",
    gold_price_per_gram: "3500",
    ltv_percent: "70",
    grace_period_days: "7",
  };

  it("accepts valid input and coerces to numbers", () => {
    const result = businessRulesSchema.parse(valid);
    expect(result).toEqual({
      interest_rate_percent: 5,
      gold_price_per_gram: 3500,
      ltv_percent: 70,
      grace_period_days: 7,
    });
  });

  it("rejects negative interest rate", () => {
    const result = businessRulesSchema.safeParse({ ...valid, interest_rate_percent: "-1" });
    expect(result.success).toBe(false);
  });

  it("rejects negative gold price", () => {
    const result = businessRulesSchema.safeParse({ ...valid, gold_price_per_gram: "-100" });
    expect(result.success).toBe(false);
  });

  it("rejects LTV% of 0 or over 100", () => {
    expect(businessRulesSchema.safeParse({ ...valid, ltv_percent: "0" }).success).toBe(false);
    expect(businessRulesSchema.safeParse({ ...valid, ltv_percent: "101" }).success).toBe(false);
  });

  it("rejects a non-integer grace period", () => {
    const result = businessRulesSchema.safeParse({ ...valid, grace_period_days: "2.5" });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric input", () => {
    const result = businessRulesSchema.safeParse({ ...valid, gold_price_per_gram: "abc" });
    expect(result.success).toBe(false);
  });
});
