import { describe, expect, it } from "vitest";
import { changedRates, damagesExample, formatRate, toNumber, type RateValues } from "./rate-changes";

const saved: RateValues = {
  price_24k: 3550,
  price_21k: 3106.25,
  price_18k: 3000,
  interest_rate_percent: 5,
  ltv_percent: 70,
  grace_period_days: 7,
  liquidated_damages_percent: 2,
};

describe("changedRates (SR4)", () => {
  it("lists nothing when every box still holds the saved value, even typed differently", () => {
    expect(changedRates(saved, { ...saved, price_24k: "3550.00", interest_rate_percent: "5", grace_period_days: " 7 " })).toEqual([]);
  });

  it("lists only the changed values, old → new, in page order", () => {
    expect(changedRates(saved, { ...saved, liquidated_damages_percent: "0", price_18k: "3000.01" })).toEqual([
      ["18K price per gram", "₱3,000.00 → ₱3,000.01"],
      ["Liquidated damages", "2% → 0%"],
    ]);
  });

  it("shows an emptied box and a wrong value as they are (the server check explains)", () => {
    expect(changedRates(saved, { ...saved, ltv_percent: "", grace_period_days: "abc" })).toEqual([
      ["Loan-to-value", "70% → (empty)"],
      ["Grace period", "7 days → abc"],
    ]);
  });
});

describe("formatRate", () => {
  it("formats pesos, percents and days", () => {
    expect(formatRate("peso", 3106.25)).toBe("₱3,106.25");
    expect(formatRate("percent", "2.50")).toBe("2.5%");
    expect(formatRate("days", 1)).toBe("1 day");
    expect(formatRate("days", "7")).toBe("7 days");
  });
});

describe("toNumber", () => {
  it("reads numbers and treats empty or wrong text as null", () => {
    expect(toNumber("12.5")).toBe(12.5);
    expect(toNumber(0)).toBe(0);
    expect(toNumber("")).toBeNull();
    expect(toNumber("x")).toBeNull();
    expect(toNumber(null)).toBeNull();
  });
});

describe("damagesExample (SR3)", () => {
  it("is the % of ₱10,000 for every 30 days, to the centavo", () => {
    expect(damagesExample(2)).toBe(200);
    expect(damagesExample("2.25")).toBe(225);
    expect(damagesExample("0.333")).toBe(33.3);
    expect(damagesExample(0)).toBe(0);
  });

  it("is left out for an empty or negative %", () => {
    expect(damagesExample("")).toBeNull();
    expect(damagesExample(-1)).toBeNull();
  });
});
