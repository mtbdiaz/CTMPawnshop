import { describe, expect, it } from "vitest";
import { isPawnable } from "./pool";

const base = { status: "available", archived_at: null, is_counterfeit_risk: false, counterfeit_resolution: null };

describe("appraisal pool", () => {
  it("offers available, unflagged items", () => expect(isPawnable(base)).toBe(true));
  it("hides pawned items", () => expect(isPawnable({ ...base, status: "pawned" })).toBe(false));
  it("hides archived items", () => expect(isPawnable({ ...base, archived_at: "2026-01-01" })).toBe(false));
  it("hides items awaiting counterfeit review", () =>
    expect(isPawnable({ ...base, is_counterfeit_risk: true, counterfeit_resolution: "pending" })).toBe(false));
  it("hides confirmed counterfeits", () =>
    expect(isPawnable({ ...base, is_counterfeit_risk: true, counterfeit_resolution: "confirmed" })).toBe(false));
  it("offers flagged items an Admin cleared", () =>
    expect(isPawnable({ ...base, is_counterfeit_risk: true, counterfeit_resolution: "cleared" })).toBe(true));
});
