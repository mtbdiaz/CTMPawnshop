import { describe, it, expect } from "vitest";
import { countDiscrepancies } from "./audit";

describe("countDiscrepancies (PB-25)", () => {
  it("counts zero when everything is found", () => {
    expect(countDiscrepancies([{ found: true }, { found: true }])).toBe(0);
  });

  it("counts items not found", () => {
    expect(countDiscrepancies([{ found: true }, { found: false }, { found: false }])).toBe(2);
  });

  it("handles an empty list", () => {
    expect(countDiscrepancies([])).toBe(0);
  });
});
