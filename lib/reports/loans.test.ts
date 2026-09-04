import { describe, it, expect } from "vitest";
import { daysOverdue, daysInVault } from "./loans";

describe("daysOverdue (PB-35)", () => {
  it("is 0 for a future or today's maturity", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(daysOverdue(new Date("2026-01-02T00:00:00Z"), now)).toBe(0);
    expect(daysOverdue(now, now)).toBe(0);
  });

  it("counts full days past maturity", () => {
    const now = new Date("2026-01-10T00:00:00Z");
    expect(daysOverdue(new Date("2026-01-01T00:00:00Z"), now)).toBe(9);
  });
});

describe("daysInVault (PB-36)", () => {
  it("counts days since the item entered the vault", () => {
    const now = new Date("2026-02-01T00:00:00Z");
    expect(daysInVault(new Date("2026-01-01T00:00:00Z"), now)).toBe(31);
  });

  it("is 0 for an item entered today", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(daysInVault(now, now)).toBe(0);
  });
});
