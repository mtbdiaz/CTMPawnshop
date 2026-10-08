import { describe, it, expect } from "vitest";
import { businessRulesSchema } from "./settings";

describe("businessRulesSchema (PB-6 AC2, item 3)", () => {
  const valid = { interest_rate_percent: "5", price_24k: "3550", price_21k: "3106.25", price_18k: "2662.50", ltv_percent: "70", grace_period_days: "7" };

  it("accepts valid input and coerces to numbers", () => {
    expect(businessRulesSchema.parse(valid)).toEqual({
      interest_rate_percent: 5,
      price_24k: 3550,
      price_21k: 3106.25,
      price_18k: 2662.5,
      ltv_percent: 70,
      grace_period_days: 7,
    });
  });

  it("requires every karat price to be positive", () => {
    expect(businessRulesSchema.safeParse({ ...valid, price_18k: "0" }).success).toBe(false);
    expect(businessRulesSchema.safeParse({ ...valid, price_21k: "-1" }).success).toBe(false);
  });

  it("rejects negative interest, LTV out of range and fractional grace days", () => {
    expect(businessRulesSchema.safeParse({ ...valid, interest_rate_percent: "-1" }).success).toBe(false);
    expect(businessRulesSchema.safeParse({ ...valid, ltv_percent: "0" }).success).toBe(false);
    expect(businessRulesSchema.safeParse({ ...valid, ltv_percent: "101" }).success).toBe(false);
    expect(businessRulesSchema.safeParse({ ...valid, grace_period_days: "1.5" }).success).toBe(false);
  });
});
