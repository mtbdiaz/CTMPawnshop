import { describe, it, expect } from "vitest";
import { isPastGracePeriod } from "./default-detection";

describe("isPastGracePeriod (PB-21)", () => {
  const maturity = new Date("2026-01-01T00:00:00Z");

  it("is false before maturity", () => {
    expect(isPastGracePeriod(maturity, 7, new Date("2025-12-31T00:00:00Z"))).toBe(false);
  });

  it("is false within the grace period after maturity", () => {
    expect(isPastGracePeriod(maturity, 7, new Date("2026-01-05T00:00:00Z"))).toBe(false);
  });

  it("is false exactly at the grace deadline", () => {
    expect(isPastGracePeriod(maturity, 7, new Date("2026-01-08T00:00:00Z"))).toBe(false);
  });

  it("is true once the grace period has passed", () => {
    expect(isPastGracePeriod(maturity, 7, new Date("2026-01-09T00:00:00Z"))).toBe(true);
  });
});
