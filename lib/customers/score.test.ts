import { describe, it, expect } from "vitest";
import { computeCustomerScore, tierFor, weightsFromRows, type ScoreLoan } from "./score";

const TODAY = "2026-10-08";
const loan = (o: Partial<ScoreLoan>): ScoreLoan => ({
  status: "redeemed",
  loan_date: "2026-06-01",
  maturity_date: "2026-07-01",
  extension_count: 0,
  late_payment_count: 0,
  defaulted_at: null,
  reinstated_at: null,
  redeemed_at: "2026-06-25",
  ...o,
});

describe("computeCustomerScore", () => {
  it("shows no score for a customer with no loans", () => {
    expect(computeCustomerScore([], TODAY)).toMatchObject({ score: null, tier: null, hasWarnings: false });
  });

  it("rewards on-time redemptions", () => {
    const r = computeCustomerScore([loan({}), loan({}), loan({})], TODAY);
    expect(r.score).toBe(84);
    expect(r.tier).toBe("Good");
    expect(r.counts.redeemed).toBe(3);
  });

  it("clamps at 100 and gives Excellent", () => {
    const r = computeCustomerScore(Array.from({ length: 10 }, () => loan({})), TODAY);
    expect(r.score).toBe(100);
    expect(r.tier).toBe("Excellent");
  });

  it("caps renewal points", () => {
    const r = computeCustomerScore([loan({ status: "active", maturity_date: "2026-12-01", redeemed_at: null, extension_count: 9 })], TODAY);
    expect(r.score).toBe(75); // 60 + min(27, 15)
  });

  it("scores a mixed history and raises the warning flag", () => {
    const r = computeCustomerScore(
      [
        loan({}),
        loan({ late_payment_count: 1 }), // late redemption: no on-time bonus, -6
        loan({ status: "extended", redeemed_at: null, defaulted_at: "2026-08-01T00:00:00Z", reinstated_at: "2026-08-10T00:00:00Z", maturity_date: "2026-11-30", extension_count: 1 }),
      ],
      TODAY,
    );
    // 60 + 8 - 6 - 25 - 15 + 3 = 25
    expect(r.score).toBe(25);
    expect(r.tier).toBe("Risky");
    expect(r.hasWarnings).toBe(true);
    expect(r.counts).toMatchObject({ total: 3, delinquent: 1, reinstated: 1, defaulted: 1 });
  });

  it("penalises a defaulted customer and never goes below 0", () => {
    expect(computeCustomerScore([loan({ status: "defaulted", redeemed_at: null, defaulted_at: "2026-09-01T00:00:00Z" })], TODAY).score).toBe(35);
    const many = Array.from({ length: 5 }, () => loan({ status: "forfeited", redeemed_at: null, defaulted_at: "2026-09-01T00:00:00Z" }));
    expect(computeCustomerScore(many, TODAY).score).toBe(0);
  });

  it("applies the currently-overdue penalty to open loans past maturity", () => {
    const r = computeCustomerScore([loan({ status: "active", redeemed_at: null, maturity_date: "2026-10-01" })], TODAY);
    expect(r.score).toBe(50);
    expect(r.counts.overdue).toBe(1);
  });

  it("counts outcomes older than 24 months at half weight", () => {
    const old = loan({ loan_date: "2024-01-01", redeemed_at: "2024-01-20", status: "defaulted", defaulted_at: "2024-02-15T00:00:00Z" });
    expect(computeCustomerScore([old], TODAY).score).toBe(48); // 60 - 12.5 -> 47.5 rounds to 48
  });

  it("reads tuned weights from the config table rows", () => {
    const w = weightsFromRows([{ key: "base", value: 50 }, { key: "unknown", value: 1 }]);
    expect(w.base).toBe(50);
    expect(computeCustomerScore([loan({})], TODAY, w).score).toBe(58);
  });
});

describe("tierFor", () => {
  it("maps the tier boundaries", () => {
    expect([85, 84, 70, 69, 50, 49].map(tierFor)).toEqual(["Excellent", "Good", "Good", "Fair", "Fair", "Risky"]);
  });
});
