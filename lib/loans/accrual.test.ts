import { describe, it, expect } from "vitest";
import { accruedDamages, accruedInterest, capitalizePreview, renewPreview, splitPayment } from "./accrual";

const base = {
  principal_balance: 10000,
  interest_owed: 0,
  interest_rate_percent: 5,
  maturity_date: "2026-10-01",
  interest_accrued_through: "2026-10-01",
  status: "active",
  // LD (0073): 0% in these older interest tests; the liquidated damages tests below set their own %
  grace_period_days: 7,
  liquidated_damages_percent: 0,
  damages_owed: 0,
  damages_accrued_through: null as string | null,
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
  it("adds unpaid accrued interest to principal and starts the new term where that interest ends", () => {
    const r = capitalizePreview({ ...base, maturity_date: "2026-08-29", interest_accrued_through: "2026-08-29" }, "2026-10-08");
    // 40 days past -> 2 terms of 500, which pay up to Oct 28; the new term runs Oct 28 -> Nov 27
    expect(r.capitalized).toBe(1000);
    expect(r.newPrincipal).toBe(11000);
    expect(r.newInterestOwed).toBe(550);
    expect(r.newMaturity).toBe("2026-11-27");
  });

  it("never charges the same days twice (#30: new term does not start before the paid-up date)", () => {
    const loan = { ...base, maturity_date: "2026-10-16", interest_accrued_through: "2026-10-16" };
    const r = capitalizePreview(loan, "2026-11-05");
    const paidUpTo = accruedInterest(loan, "2026-11-05").accruedThrough; // Nov 15
    expect(paidUpTo).toBe("2026-11-15");
    expect(r.newMaturity).toBe("2026-12-15");
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
    expect(r).toMatchObject({ collectNow: 500, newMaturity: "2026-11-19", newInterestOwed: 500 }); // LD: plus collectInterest / collectDamages
  });

  it("collects accrued terms when renewing inside grace", () => {
    const r = renewPreview({ ...base, interest_owed: 500 }, "2026-10-05");
    expect(r.collectNow).toBe(1000);
    expect(r.newMaturity).toBe("2026-11-30");
  });
});

// LD (0073, Matt, Nov 14): the pawn ticket's liquidated damages clause. Mirrors ctm_pending_damages / ctm_accrue_interest
describe("accruedDamages (liquidated damages after the grace days)", () => {
  const ld = { ...base, liquidated_damages_percent: 2 }; // due Oct 1, 7 grace days -> damages count from Oct 8
  it("charges nothing up to the last grace day", () => {
    expect(accruedDamages(ld, "2026-10-01").damagesOwed).toBe(0);
    expect(accruedDamages(ld, "2026-10-08")).toMatchObject({ damagesOwed: 0, extraMonths: 0, from: "2026-10-08" });
  });
  it("charges 2% of the unpaid principal for any part of each 30 days after that", () => {
    expect(accruedDamages(ld, "2026-10-09")).toMatchObject({ damagesOwed: 200, extraMonths: 1, accruedThrough: "2026-11-07" }); // 1 day late = a full month
    expect(accruedDamages(ld, "2026-11-07").extraMonths).toBe(1);
    expect(accruedDamages(ld, "2026-11-08")).toMatchObject({ damagesOwed: 400, extraMonths: 2 });
  });
  it("uses the principal still unpaid, adds to what is already written down, and keeps counting while defaulted", () => {
    const r = accruedDamages({ ...ld, principal_balance: 6000, damages_owed: 120, damages_accrued_through: "2026-11-07", status: "defaulted" }, "2026-11-20");
    expect(r).toMatchObject({ damagesOwed: 240, extraMonths: 1 }); // 120 already + 1 month of 2% of 6,000
  });
  it("stops for redeemed, forfeited or fully paid loans, and at 0%", () => {
    expect(accruedDamages({ ...ld, status: "forfeited" }, "2027-01-01").damagesOwed).toBe(0);
    expect(accruedDamages({ ...ld, principal_balance: 0 }, "2027-01-01").damagesOwed).toBe(0);
    expect(accruedDamages(base, "2027-01-01").damagesOwed).toBe(0);
  });
  it("Renew collects interest and damages together", () => {
    const r = renewPreview({ ...ld, status: "reinstated" }, "2026-10-09");
    expect(r).toMatchObject({ collectInterest: 500, collectDamages: 200, collectNow: 700 });
  });
});

describe("splitPayment (record_payment's order)", () => {
  it("pays liquidated damages first, then interest, then principal", () => {
    const due = { damages: 200, interest: 500, principal: 10000 };
    expect(splitPayment(150, due)).toEqual({ damages: 150, interest: 0, principal: 0 });
    expect(splitPayment(600, due)).toEqual({ damages: 200, interest: 400, principal: 0 });
    expect(splitPayment(1000, due)).toEqual({ damages: 200, interest: 500, principal: 300 });
  });
});
