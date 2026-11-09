import { describe, expect, it } from "vitest";
import { owedDisplay, pastGracePeriod, renewBlocked, renewGraceEnd, situationBadge, stateBadge, wouldBeDefaulted } from "./display"; // A1: + pastGracePeriod
import { accruedInterest } from "./accrual";

const today = "2026-11-05";
const base = { principal_balance: 8300, interest_owed: 415, interest_rate_percent: 5, maturity_date: "2026-11-20", interest_accrued_through: "2026-11-20", status: "active" };

describe("stateBadge", () => {
  it("names each stored state, renewed for extended", () => {
    expect(stateBadge("extended").label).toBe("Renewed");
    expect(stateBadge("reinstated").label).toBe("Reinstated");
    expect(stateBadge("forfeited").label).toBe("Forfeited");
  });
});

describe("situationBadge", () => {
  it("nothing for a running loan not due soon", () => {
    expect(situationBadge({ ...base, maturity_date: "2026-12-20", interest_accrued_through: "2026-12-20" }, today)).toBeNull();
  });
  it("due soon within 7 days, including today", () => {
    expect(situationBadge(base, "2026-11-13")?.label).toBe("Due soon");
    expect(situationBadge(base, "2026-11-20")?.label).toBe("Due soon");
  });
  it("overdue when past due and owing", () => {
    expect(situationBadge(base, "2026-11-21")?.label).toBe("Overdue");
  });
  it("paid, ready to release when nothing is owed, even past due", () => {
    expect(situationBadge({ ...base, principal_balance: 0, interest_owed: 0 }, "2026-12-30")?.label).toBe("Paid, ready to release");
  });
  it("a reinstated loan can be overdue again", () => {
    expect(situationBadge({ ...base, status: "reinstated" }, "2026-11-25")?.label).toBe("Overdue");
  });
  it("closed or defaulted loans get no situation badge", () => {
    for (const status of ["defaulted", "forfeited", "redeemed"]) expect(situationBadge({ ...base, status }, "2026-12-30")).toBeNull();
  });
});

describe("owedDisplay", () => {
  it("defaulted loans still show what they owe, with interest after the due date", () => {
    const loan = { ...base, status: "defaulted" };
    expect(owedDisplay(loan, "2026-12-30")).toBe(8300 + accruedInterest(loan, "2026-12-30").interestOwed);
  });
  it("forfeited shows no amount, redeemed shows 0", () => {
    expect(owedDisplay({ ...base, status: "forfeited" }, today)).toBeNull();
    expect(owedDisplay({ ...base, status: "redeemed" }, today)).toBe(0);
  });
  it("the stored-balance rule matches: no interest grows on 0 principal", () => {
    const paid = { ...base, principal_balance: 0, interest_owed: 0 };
    expect(owedDisplay(paid, "2027-06-01")).toBe(0);
  });
});

describe("renewBlocked (L24, same rule as renew_loan)", () => {
  const loan = { status: "active", maturity_date: "2026-10-29", grace_period_days: 7 };
  it("can renew up to and including the last grace day", () => {
    expect(renewGraceEnd(loan)).toBe("2026-11-05");
    expect(renewBlocked(loan, "2026-11-05")).toBe(false);
  });
  it("can't renew the day after the grace period", () => {
    expect(renewBlocked(loan, "2026-11-06")).toBe(true);
    expect(renewBlocked({ ...loan, status: "extended" }, "2026-11-06")).toBe(true);
  });
  it("reinstated loans have no grace limit", () => {
    expect(renewGraceEnd({ ...loan, status: "reinstated" })).toBeNull();
    expect(renewBlocked({ ...loan, status: "reinstated" }, "2027-06-01")).toBe(false);
  });
});

describe("wouldBeDefaulted (L30, same rule as run_default_detection)", () => {
  // A1: the loan still owes money (the database only defaults loans that do, since Matt's fix #1)
  const loan = { status: "active", maturity_date: "2026-10-29", grace_period_days: 7, archived_at: null, principal_balance: 1000, interest_owed: 50 };
  it("not on the last grace day, yes the day after", () => {
    expect(wouldBeDefaulted(loan, "2026-11-05")).toBe(false);
    expect(wouldBeDefaulted(loan, "2026-11-06")).toBe(true);
    expect(wouldBeDefaulted({ ...loan, status: "extended" }, "2026-11-06")).toBe(true);
  });
  it("skips closed and archived loans", () => {
    for (const status of ["defaulted", "forfeited", "redeemed"]) expect(wouldBeDefaulted({ ...loan, status }, "2027-01-01")).toBe(false);
    expect(wouldBeDefaulted({ ...loan, archived_at: "2026-11-01" }, "2027-01-01")).toBe(false);
  });
  // owner decision on Matt #3/#4: a reinstated loan that misses its grace period defaults again
  it("defaults a reinstated loan past its grace period", () => {
    expect(wouldBeDefaulted({ ...loan, status: "reinstated" }, "2027-01-01")).toBe(true);
  });
  it("a missing grace period counts as 0 days", () => {
    expect(wouldBeDefaulted({ ...loan, grace_period_days: null }, "2026-10-30")).toBe(true);
  });
  // A1: Matt's fix #1 (migration 0020): a loan that owes ₱0 is never defaulted, but it is still past the grace period
  it("skips a fully paid loan, which is still past the grace period", () => {
    const paid = { ...loan, principal_balance: 0, interest_owed: 0 }; // like Pedro Reyes's loan
    expect(wouldBeDefaulted(paid, "2026-11-06")).toBe(false); // the database skips it
    expect(pastGracePeriod(paid, "2026-11-06")).toBe(true); // so the Admin box lists it as "skipped"
  });
  // A1: owing only interest (principal paid off) still counts as owing money, same as the database
  it("still defaults a loan that owes only interest", () => {
    expect(wouldBeDefaulted({ ...loan, principal_balance: 0, interest_owed: 50 }, "2026-11-06")).toBe(true);
  });
});
