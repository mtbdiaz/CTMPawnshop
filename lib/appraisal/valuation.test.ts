import { describe, it, expect } from "vitest";
import { calculateKaratValuation, categoryLabel, isAcceptedKarat, pricePerGram } from "./valuation";

const prices = { price_24k: 3550, price_21k: 3106.25, price_18k: 2662.5 };

describe("karat valuation (owner formula: weight x price per gram of the karat)", () => {
  it("uses the price for the chosen karat, with no purity multiplier", () => {
    const r = calculateKaratValuation(10, 18, prices, 70);
    expect(r.pricePerGram).toBe(2662.5);
    expect(r.value).toBe(26625);
  });

  it("applies LTV to get the maximum loan, min is 90% of max", () => {
    const r = calculateKaratValuation(10, 24, prices, 70);
    expect(r.value).toBe(35500);
    expect(r.suggestedLoanMax).toBe(24850);
    expect(r.suggestedLoanMin).toBe(22365);
  });

  it("rounds to centavos", () => {
    expect(calculateKaratValuation(3.333, 21, prices, 70).value).toBe(10353.13);
  });

  it("returns zero for unsupported karats and non-positive weight", () => {
    expect(pricePerGram(14, prices)).toBe(0);
    expect(calculateKaratValuation(10, 14, prices, 70).value).toBe(0);
    expect(calculateKaratValuation(-5, 24, prices, 70).value).toBe(0);
  });

  it("accepts only 24K, 21K and 18K", () => {
    expect([24, 21, 18].every(isAcceptedKarat)).toBe(true);
    expect([22, 14, 10].some(isAcceptedKarat)).toBe(false);
  });
});

describe("categoryLabel", () => {
  it("shows the free text for Others", () => {
    expect(categoryLabel("others", "Anklet")).toBe("Others (Anklet)");
    expect(categoryLabel("pendant_with_chain")).toBe("Pendant w/ Chain");
    expect(categoryLabel(null)).toBe("Others");
  });
});
