import { describe, it, expect } from "vitest";
import {
  calculateMaturityDate,
  calculateInterestDue,
  applyPayment,
  validatePaymentAmount,
  calculateExtension,
  LOAN_TERM_DAYS,
} from "./calculations";

describe("calculateMaturityDate (PB-17)", () => {
  it("adds the loan term in days", () => {
    const loanDate = new Date("2026-01-01T00:00:00Z");
    const maturity = calculateMaturityDate(loanDate);
    expect(maturity.getUTCDate() === 31 || maturity.getUTCMonth() === 1).toBe(true);
    const diffDays = Math.round((maturity.getTime() - loanDate.getTime()) / 86_400_000);
    expect(diffDays).toBe(LOAN_TERM_DAYS);
  });
});

describe("calculateInterestDue", () => {
  it("computes one period's interest on the balance", () => {
    expect(calculateInterestDue(10000, 5)).toBe(500);
  });
});

describe("applyPayment (PB-18)", () => {
  it("settles interest first, remainder reduces principal", () => {
    const result = applyPayment(600, 10000, 500);
    expect(result.interestPortion).toBe(500);
    expect(result.principalPortion).toBe(100);
    expect(result.newPrincipalBalance).toBe(9900);
  });

  it("an interest-only payment doesn't touch principal", () => {
    const result = applyPayment(500, 10000, 500);
    expect(result.principalPortion).toBe(0);
    expect(result.newPrincipalBalance).toBe(10000);
  });

  it("caps principal portion at the remaining balance", () => {
    const result = applyPayment(10500, 10000, 500);
    expect(result.newPrincipalBalance).toBe(0);
    expect(result.principalPortion).toBe(10000);
  });
});

describe("validatePaymentAmount (PB-18 AC2)", () => {
  it("rejects zero or negative amounts", () => {
    expect(validatePaymentAmount(0, 10000, 500).ok).toBe(false);
    expect(validatePaymentAmount(-10, 10000, 500).ok).toBe(false);
  });

  it("rejects an amount exceeding principal + interest owed", () => {
    expect(validatePaymentAmount(10600, 10000, 500).ok).toBe(false);
  });

  it("accepts an amount within the total owed", () => {
    expect(validatePaymentAmount(10500, 10000, 500).ok).toBe(true);
  });
});

describe("calculateExtension (PB-19)", () => {
  it("pushes maturity out by the loan term and charges one interest period", () => {
    const current = new Date("2026-02-01T00:00:00Z");
    const result = calculateExtension(current, 10000, 5);
    const diffDays = Math.round((result.newMaturityDate.getTime() - current.getTime()) / 86_400_000);
    expect(diffDays).toBe(LOAN_TERM_DAYS);
    expect(result.additionalInterestAmount).toBe(500);
  });
});
