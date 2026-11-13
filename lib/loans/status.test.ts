// F3 regression tests: the shared "paid vs overdue" rule
import { describe, it, expect } from "vitest";
import { isFullyPaid, isOverdueUnpaid, owedNow } from "./status";

const TODAY = "2026-11-04";
// a loan with ₱10,000 principal at 3% per 30 days, due Oct 15 (so it is past due today)
const base = { status: "active", maturity_date: "2026-10-15", principal_balance: 10000, interest_owed: 300, interest_rate_percent: 3, interest_accrued_through: "2026-10-15", grace_period_days: 7, liquidated_damages_percent: 0, damages_owed: 0, damages_accrued_through: null as string | null }; // LD: 0% here, so these older tests keep testing interest only

describe("F3: paid vs overdue", () => {
  it("partial payment, past due: still owes money, so it is overdue", () => {
    const loan = { ...base, principal_balance: 4000, interest_owed: 0 }; // paid part of it
    expect(isFullyPaid(loan, TODAY)).toBe(false); // money still owed
    expect(isOverdueUnpaid(loan, TODAY)).toBe(true); // overdue
    expect(owedNow(loan, TODAY)).toBe(4120); // ₱4,000 + one late term of 3% = ₱4,120
  });

  it("full payment, item not released yet: NOT overdue (release pending)", () => {
    const loan = { ...base, principal_balance: 0, interest_owed: 0 }; // paid in full, still "active" until release
    expect(isFullyPaid(loan, TODAY)).toBe(true); // nothing left
    expect(isOverdueUnpaid(loan, TODAY)).toBe(false); // not overdue
  });

  it("release completed (redeemed): never overdue", () => {
    expect(isOverdueUnpaid({ ...base, status: "redeemed", principal_balance: 0, interest_owed: 0 }, TODAY)).toBe(false);
  });

  it("renewal: due date moved to the future, not overdue even with money owed", () => {
    expect(isOverdueUnpaid({ ...base, status: "extended", maturity_date: "2026-11-14", interest_accrued_through: "2026-11-14" }, TODAY)).toBe(false);
  });

  it("renewed but past the new due date and unpaid: overdue", () => {
    expect(isOverdueUnpaid({ ...base, status: "extended" }, TODAY)).toBe(true);
  });

  it("reinstated: overdue only while money is still owed", () => {
    expect(isOverdueUnpaid({ ...base, status: "reinstated" }, TODAY)).toBe(true); // owes money
    expect(isOverdueUnpaid({ ...base, status: "reinstated", principal_balance: 0, interest_owed: 0 }, TODAY)).toBe(false); // paid
  });

  it("defaulted (forfeit pending) is not counted as 'overdue'; it has its own status", () => {
    expect(isOverdueUnpaid({ ...base, status: "defaulted" }, TODAY)).toBe(false);
  });

  it("due today is not overdue yet", () => {
    expect(isOverdueUnpaid({ ...base, maturity_date: TODAY, interest_accrued_through: TODAY }, TODAY)).toBe(false);
  });

  it("a tiny decimal leftover (0.004) counts as paid", () => {
    expect(isFullyPaid({ ...base, principal_balance: 0, interest_owed: 0.004 }, TODAY)).toBe(true);
  });
});
