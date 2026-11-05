import { describe, expect, it } from "vitest";
import { appraisalState } from "./status";
import { compareAppraisal } from "./edit";
import { isPawnable } from "./pool";

const base = { status: "available", archived_at: null, is_counterfeit_risk: false, counterfeit_resolution: null };

describe("appraisalState (A1)", () => {
  it("no flag is Available and loanable", () => {
    expect(appraisalState(base)).toMatchObject({ key: "available", label: "Available", loanable: true });
  });
  it("a flag waiting for an Admin is Counterfeit review, not loanable", () => {
    expect(appraisalState({ ...base, is_counterfeit_risk: true, counterfeit_resolution: "pending" })).toMatchObject({ key: "review", loanable: false });
  });
  it("a flag with no resolution yet is still review", () => {
    expect(appraisalState({ ...base, is_counterfeit_risk: true })).toMatchObject({ key: "review", loanable: false });
  });
  it("a cleared flag is Available", () => {
    expect(appraisalState({ ...base, is_counterfeit_risk: true, counterfeit_resolution: "cleared" })).toMatchObject({ key: "available", loanable: true });
  });
  it("a confirmed risk is never loanable", () => {
    expect(appraisalState({ ...base, is_counterfeit_risk: true, counterfeit_resolution: "confirmed" })).toMatchObject({ key: "confirmed", label: "Confirmed risk", loanable: false });
  });
  it("pawned and archived win over the flag", () => {
    expect(appraisalState({ ...base, status: "pawned" }).key).toBe("pawned");
    expect(appraisalState({ ...base, archived_at: "2026-11-01", is_counterfeit_risk: true, counterfeit_resolution: "pending" }).key).toBe("archived");
  });
});

const item = { category: "ring", category_other: null, karat: 18, weight_grams: 1.899, condition_notes: "Scratched" };

describe("compareAppraisal (A2, A3)", () => {
  it("unchanged is not a change, even with string numbers and blank vs null", () => {
    expect(compareAppraisal(item, { ...item, weight_grams: Number("1.899"), category_other: "", condition_notes: " Scratched " })).toEqual({ any: false, reprice: false, material: false });
  });
  it("notes only: saved, no re-price, not material", () => {
    expect(compareAppraisal(item, { ...item, condition_notes: "Clasp loose" })).toEqual({ any: true, reprice: false, material: false });
  });
  it("category only: material but no re-price", () => {
    expect(compareAppraisal(item, { ...item, category: "chain" })).toEqual({ any: true, reprice: false, material: true });
  });
  it("karat or weight: re-price and material", () => {
    expect(compareAppraisal(item, { ...item, karat: 21 })).toEqual({ any: true, reprice: true, material: true });
    expect(compareAppraisal(item, { ...item, weight_grams: 1.9 })).toEqual({ any: true, reprice: true, material: true });
  });
});

// Regression guard: the badge rule (status.ts) and the New Loan picker rule (pool.ts) must always agree,
// so an item never shows "Available" but can't be picked, or the other way around. Both match create_pawn_loan.
describe("badge and New Loan picker agree", () => {
  it("for every combination of status, archive and flag", () => {
    for (const status of ["available", "pawned"])
      for (const archived_at of [null, "2026-11-01"])
        for (const is_counterfeit_risk of [false, true])
          for (const counterfeit_resolution of [null, "pending", "cleared", "confirmed"]) {
            const a = { status, archived_at, is_counterfeit_risk, counterfeit_resolution };
            expect(appraisalState(a).loanable).toBe(isPawnable(a));
          }
  });
});

describe("weightError (P7)", async () => {
  const { weightError } = await import("@/app/dashboard/appraisals/appraisal-fields");
  it("accepts normal weights and an empty box", () => {
    for (const ok of ["", "1", "3.25", "0.001", "5000", "12.345"]) expect(weightError(ok)).toBeNull();
  });
  it("refuses 0, negative, too big, text and 4 decimals", () => {
    for (const bad of ["0", "-1", "5000.5", "abc", "1.2345"]) expect(weightError(bad)).not.toBeNull();
  });
});
