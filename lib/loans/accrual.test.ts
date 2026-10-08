import { describe, it, expect } from "vitest";
import { accruedInterest, capitalizePreview, renewPreview } from "./accrual";

const base = {
  principal_balance: 10000,
  interest_owed: 0,
  interest_rate_percent: 5,
  maturity_date: "2026-10-01",
  interest_accrued_through: "2026-10-01",
  status: "active",
};

describe("accruedInterest (mirrors ctm_accrue_interest)", () => {
  it("charges nothing extra on or before maturity", () => {
    expect(accruedInterest({ ...base, interest_owed: 500 }, "2026-10-01").interestOwed).toBe(500);
  });

  it("charges a full term for any part of a 30-day period past maturity", () => {
    expect(accruedInterest(base, "2026-10-02")).toMatchObject({ interestOwed: 500, extraTerms: 1, accruedThrough: "2026-10-31" });
    expect(accruedInterest(base, "2026-10-31").extraTerms).toBe(1);
    expect(accruedInterest(base, "2026-11-01").extraTerms).toBe(2);
  });

  it("keeps accruing through the default period for reinstated loans", () => {
    const r = accruedInterest({ ...base, status: "reinstated", interest_owed: 550, principal_balance: 11000 }, "2026-11-20");
    // 50 days past -> 2 terms of 550 on top of 550 owed
    expect(r.interestOwed).toBe(1650);
  });

  it("does not accrue on closed or fully paid loans", () => {
    expect(accruedInterest({ ...base, status: "redeemed" }, "2027-01-01").interestOwed).toBe(0);
    expect(accruedInterest({ ...base, principal_balance: 0 }, "2027-01-01").interestOwed).toBe(0);
  });
});

describe("capitalizePreview (item 8)", () => {
  it("adds unpaid accrued interest to principal and extends from today when past due", () => {
    const r = capitalizePreview({ ...base, maturity_date: "2026-08-29", interest_accrued_through: "2026-08-29" }, "2026-10-08");
    // 40 days past -> 2 terms of 500
    expect(r.capitalized).toBe(1000);
    expect(r.newPrincipal).toBe(11000);
    expect(r.newInterestOwed).toBe(550);
    expect(r.newMaturity).toBe("2026-11-07");
  });

  it("extends from the current maturity when not yet due", () => {
    const r = capitalizePreview({ ...base, interest_owed: 500, maturity_date: "2026-10-20", interest_accrued_through: "2026-10-20" }, "2026-10-08");
    expect(r.capitalized).toBe(500);
    expect(r.newMaturity).toBe("2026-11-19");
  });
});

describe("renewPreview (pay-and-renew)", () => {
  it("collects the term's interest and moves maturity one term", () => {
    const r = renewPreview({ ...base, interest_owed: 500, maturity_date: "2026-10-20", interest_accrued_through: "2026-10-20" }, "2026-10-08");
    expect(r).toEqual({ collectNow: 500, newMaturity: "2026-11-19", newInterestOwed: 500 });
  });

  it("collects accrued terms when renewing inside grace", () => {
    const r = renewPreview({ ...base, interest_owed: 500 }, "2026-10-05");
    expect(r.collectNow).toBe(1000);
    expect(r.newMaturity).toBe("2026-11-30");
  });
});
