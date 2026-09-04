import { describe, it, expect } from "vitest";
import { isDueForReminder, REMINDER_LEAD_DAYS } from "./reminders";

describe("isDueForReminder (PB-33)", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("is false for a maturity far in the future", () => {
    const maturity = new Date(now);
    maturity.setDate(maturity.getDate() + REMINDER_LEAD_DAYS + 5);
    expect(isDueForReminder(maturity, now)).toBe(false);
  });

  it("is true within the lead window", () => {
    const maturity = new Date(now);
    maturity.setDate(maturity.getDate() + 1);
    expect(isDueForReminder(maturity, now)).toBe(true);
  });

  it("is false for a maturity already in the past", () => {
    const maturity = new Date(now);
    maturity.setDate(maturity.getDate() - 1);
    expect(isDueForReminder(maturity, now)).toBe(false);
  });
});
