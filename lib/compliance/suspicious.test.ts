import { describe, it, expect } from "vitest";
import { isSuspiciousLoanVelocity, SUSPICIOUS_LOAN_COUNT_THRESHOLD } from "./suspicious";

describe("isSuspiciousLoanVelocity (PB-32)", () => {
  const now = new Date("2026-01-10T12:00:00Z");

  it("is false below the threshold", () => {
    const timestamps = Array.from({ length: SUSPICIOUS_LOAN_COUNT_THRESHOLD - 1 }, () => now);
    expect(isSuspiciousLoanVelocity(timestamps, now)).toBe(false);
  });

  it("is true at or above the threshold within the window", () => {
    const timestamps = Array.from({ length: SUSPICIOUS_LOAN_COUNT_THRESHOLD }, () => now);
    expect(isSuspiciousLoanVelocity(timestamps, now)).toBe(true);
  });

  it("ignores loans outside the window", () => {
    const old = new Date("2026-01-01T00:00:00Z");
    const timestamps = Array.from({ length: SUSPICIOUS_LOAN_COUNT_THRESHOLD }, () => old);
    expect(isSuspiciousLoanVelocity(timestamps, now)).toBe(false);
  });
});
