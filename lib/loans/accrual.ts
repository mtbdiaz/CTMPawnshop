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
  // LD (0073, Matt, Nov 14): liquidated damages. Required on purpose: a page that reads loans without these columns
  // won't compile, so no screen can quietly leave the damages out of what is owed
  grace_period_days: number;
  liquidated_damages_percent: number;
  damages_owed: number;
  damages_accrued_through: string | null;
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

/**
 * LD (0073): liquidated damages owed as of `today`, mirroring the database (ctm_pending_damages / ctm_accrue_interest).
 * The pawn ticket clause: if the loan is not paid on time, the pawner pays, on top of the interest, a % (Settings,
 * 2% now, fixed on each loan) of the principal per month, and part of a month counts as a full month.
 * Team decisions: the % is of the unpaid principal; months are 30 days counted from the day after the grace days end
 * (maturity date + grace days); a renewal starts the count again (the database clears damages_accrued_through).
 */
export function damagesStart(loan: AccrualLoan): string {
  return loan.damages_accrued_through ?? addDaysIso(loan.maturity_date, Number(loan.grace_period_days ?? 0));
}
export function monthlyDamages(loan: AccrualLoan): number {
  return round2((Number(loan.principal_balance) * Number(loan.liquidated_damages_percent)) / 100);
}
export function accruedDamages(loan: AccrualLoan, today: string): { damagesOwed: number; extraMonths: number; from: string; accruedThrough: string } {
  const from = damagesStart(loan);
  const daysPast = -daysUntilDue(from, today);
  let extraMonths = 0;
  if (ACCRUING.has(loan.status) && Number(loan.principal_balance) > 0 && Number(loan.liquidated_damages_percent) > 0 && daysPast > 0) {
    extraMonths = Math.ceil(daysPast / TERM_DAYS);
  }
  return {
    damagesOwed: round2(Number(loan.damages_owed) + extraMonths * monthlyDamages(loan)),
    extraMonths,
    from,
    accruedThrough: addDaysIso(from, extraMonths * TERM_DAYS),
  };
}

/**
 * LD: how a payment is split, the same order as the database's record_payment: liquidated damages first, then
 * interest, then principal.
 */
export function splitPayment(amount: number, due: { damages: number; interest: number; principal: number }) {
  const damages = Math.min(amount, due.damages);
  const interest = Math.min(round2(amount - damages), due.interest);
  const principal = Math.min(round2(amount - damages - interest), due.principal);
  return { damages: round2(damages), interest: round2(interest), principal: round2(principal) };
}

/** Item 8: add unpaid interest to principal and extend one term. No cash moves. */
export function capitalizePreview(loan: AccrualLoan, today: string) {
  const { interestOwed, accruedThrough } = accruedInterest(loan, today);
  const newPrincipal = round2(Number(loan.principal_balance) + interestOwed);
  // The capitalized interest already pays up to accruedThrough, so the new term starts there
  // (same rule as renew_loan); starting it today would charge the overlap twice (#30).
  const base = accruedThrough > loan.maturity_date ? accruedThrough : loan.maturity_date;
  return {
    capitalized: interestOwed,
    newPrincipal,
    newMaturity: addDaysIso(base, TERM_DAYS),
    newInterestOwed: termInterest(newPrincipal, loan.interest_rate_percent),
  };
}

/** PB-19 pay-and-renew: collect all interest owed (LD: and liquidated damages), start a fresh term. */
export function renewPreview(loan: AccrualLoan, today: string) {
  const { interestOwed, accruedThrough } = accruedInterest(loan, today);
  const { damagesOwed } = accruedDamages(loan, today);
  const base = accruedThrough > loan.maturity_date ? accruedThrough : loan.maturity_date;
  return {
    collectNow: round2(interestOwed + damagesOwed),
    collectInterest: interestOwed,
    collectDamages: damagesOwed,
    newMaturity: addDaysIso(base, TERM_DAYS),
    newInterestOwed: termInterest(loan.principal_balance, loan.interest_rate_percent),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
