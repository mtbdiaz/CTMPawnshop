import { daysUntilDue } from "@/lib/compliance/reminders";

// Mirrors the database's ctm_accrue_interest() so screens can show what is
// owed today before an action runs. The database remains authoritative.
//
// Rule (same as the loan's own term): every 30-day period, or part of one,
// that has started since interest was last accounted for adds one full term
// of interest on the current principal balance.

export const TERM_DAYS = 30;

export type AccrualLoan = {
  principal_balance: number;
  interest_owed: number;
  interest_rate_percent: number;
  maturity_date: string;
  interest_accrued_through: string | null;
  status: string;
};

const ACCRUING = new Set(["active", "extended", "reinstated", "defaulted"]);

export function termInterest(principal: number, ratePercent: number): number {
  return round2((Number(principal) * Number(ratePercent)) / 100);
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Interest owed as of `today` (Manila date), including periods not yet charged. */
export function accruedInterest(loan: AccrualLoan, today: string): { interestOwed: number; extraTerms: number; accruedThrough: string } {
  const through = loan.interest_accrued_through ?? loan.maturity_date;
  const daysPast = -daysUntilDue(through, today);
  let extraTerms = 0;
  if (ACCRUING.has(loan.status) && Number(loan.principal_balance) > 0 && daysPast > 0) {
    extraTerms = Math.ceil(daysPast / TERM_DAYS);
  }
  return {
    interestOwed: round2(Number(loan.interest_owed) + extraTerms * termInterest(loan.principal_balance, loan.interest_rate_percent)),
    extraTerms,
    accruedThrough: addDaysIso(through, extraTerms * TERM_DAYS),
  };
}

/** Item 8: add unpaid interest to principal and extend one term. No cash moves. */
export function capitalizePreview(loan: AccrualLoan, today: string) {
  const { interestOwed } = accruedInterest(loan, today);
  const newPrincipal = round2(Number(loan.principal_balance) + interestOwed);
  const base = daysUntilDue(loan.maturity_date, today) >= 0 ? loan.maturity_date : today;
  return {
    capitalized: interestOwed,
    newPrincipal,
    newMaturity: addDaysIso(base, TERM_DAYS),
    newInterestOwed: termInterest(newPrincipal, loan.interest_rate_percent),
  };
}

/** PB-19 pay-and-renew: collect all interest owed, start a fresh term. */
export function renewPreview(loan: AccrualLoan, today: string) {
  const { interestOwed, accruedThrough } = accruedInterest(loan, today);
  const base = accruedThrough > loan.maturity_date ? accruedThrough : loan.maturity_date;
  return {
    collectNow: interestOwed,
    newMaturity: addDaysIso(base, TERM_DAYS),
    newInterestOwed: termInterest(loan.principal_balance, loan.interest_rate_percent),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
