// L3 + L4: what a loan's badges say, in ONE place, so the Loans list and the loan page always agree
// (and match the Dashboard). A loan has two separate things:
//   1. its STATE in the system: Active, Renewed, Reinstated, Defaulted, Forfeited, Redeemed (stored in loans.status)
//   2. its PAYMENT SITUATION today: Paid, ready to release / Overdue / Due soon (worked out from the balances and dates)
// Nothing here changes the stored status; it only decides what the screen shows.
import { daysUntilDue } from "@/lib/compliance/reminders"; // days from today to the due date (negative = late)
import { OPEN_STATUSES, isFullyPaid, isOverdueUnpaid, owedNow } from "./status"; // the shared paid / overdue rules (F3)
import { addDaysIso, type AccrualLoan } from "./accrual"; // addDaysIso = add days to a YYYY-MM-DD date

export type LoanBadge = { status: string; label: string }; // status = the StatusBadge color, label = the words

// the words for each stored state ("extended" is what the database calls a renewed loan)
const STATE_LABELS: Record<string, string> = {
  active: "Active",
  extended: "Renewed",
  reinstated: "Reinstated",
  defaulted: "Defaulted",
  forfeited: "Forfeited",
  redeemed: "Redeemed",
};

export const DUE_SOON_DAYS = 7; // same window as the Dashboard's "Due in 7 days"

/** 1. The loan's state, e.g. "Renewed". */
export function stateBadge(status: string): LoanBadge {
  return { status, label: STATE_LABELS[status] ?? status };
}

/** 2. The payment situation today, or null when there's nothing to flag (a running loan not due yet, or a closed loan). */
export function situationBadge(loan: AccrualLoan, today: string): LoanBadge | null {
  if (!OPEN_STATUSES.has(loan.status)) return null; // defaulted, forfeited and redeemed already say it all
  if (isFullyPaid(loan, today)) return { status: "redeemed", label: "Paid, ready to release" }; // owes ₱0, the item is still in the vault
  if (isOverdueUnpaid(loan, today)) return { status: "pending", label: "Overdue" }; // past the due date and still owes money. L26: amber (needs attention), red is only for Defaulted
  const days = daysUntilDue(loan.maturity_date, today);
  if (days >= 0 && days <= DUE_SOON_DAYS) return { status: "pending", label: "Due soon" }; // due today up to 7 days from now
  return null;
}

/**
 * L5: the amount to show as "Owed now".
 * - running or defaulted loan: principal left + interest (incl. interest after the due date) + liquidated damages after the
 *   grace days (LD, 0073), the same as "To redeem today"
 * - forfeited: null, because the item became shop property and the loan isn't collected any more
 * - redeemed: 0
 */
export function owedDisplay(loan: AccrualLoan, today: string): number | null {
  if (loan.status === "forfeited") return null;
  if (loan.status === "redeemed") return 0;
  return owedNow(loan, today);
}

// L1: the same "fully paid" rule written as a database filter, so a tab can count and page through ALL loans.
// Verified against the code: interest and liquidated damages only grow while principal is above 0, and the database's
// record_payment uses principal_balance + interest_owed + damages_owed as the total owed (LD, 0073).
// So a loan owes ₱0 exactly when all three stored balances are 0. (LC5: this comment said "no fees or penalties" before 0073.)
export const STILL_OWES_FILTER = "principal_balance.gt.0,interest_owed.gt.0,damages_owed.gt.0"; // use with .or(...)

/**
 * L24: the last day a loan can still be renewed, or null when the grace period doesn't apply.
 * Same rule as the database's renew_loan: "Grace period has expired" when today > due date + grace days,
 * except reinstated loans, which the database lets renew at any time. (Capitalize has no such rule in the database.)
 */
export function renewGraceEnd(loan: { status: string; maturity_date: string; grace_period_days: number }): string | null {
  if (loan.status === "reinstated") return null; // reinstated loans skip the grace check
  return addDaysIso(loan.maturity_date, loan.grace_period_days); // due date + grace days
}

/**
 * LC3 (Nov 14): the loan page's "Grace period" line, from the loan's own saved grace days (not today's Settings):
 * "7 days, until Dec 18, 2026" while it runs (the last grace day included), "7 days, ended Nov 13, 2026" after,
 * "None (0 days on this loan)" for 0. formatDay turns an ISO date into the page's date format.
 */
export function graceSummary(loan: { maturity_date: string; grace_period_days: number }, today: string, formatDay: (iso: string) => string): string {
  const days = Number(loan.grace_period_days ?? 0);
  if (days <= 0) return "None (0 days on this loan)";
  const end = addDaysIso(loan.maturity_date, days);
  return `${days} ${days === 1 ? "day" : "days"}, ${today > end ? "ended" : "until"} ${formatDay(end)}`;
}

/** L24: true when renew_loan would refuse this loan today because the grace period is over. */
export function renewBlocked(loan: { status: string; maturity_date: string; grace_period_days: number }, today: string): boolean {
  const end = renewGraceEnd(loan);
  return end !== null && today > end; // ISO dates (YYYY-MM-DD) compare correctly as text
}

// A1: the loan fields the default check needs (the stored balances are what the database looks at)
type DefaultCheckLoan = {
  status: string; // active / extended (renewed) / reinstated / ...
  maturity_date: string; // due date, YYYY-MM-DD
  grace_period_days: number | null; // extra days after the due date (null counts as 0)
  archived_at?: string | null; // archived loans are never checked
  principal_balance: number; // stored principal still unpaid
  interest_owed: number; // stored interest still unpaid
};

/**
 * A1: true when an active, renewed or reinstated loan is past its due date + grace days (the date part of the check).
 * Reinstated, closed and archived loans are never checked by the database (Matt #3), so they are false here too.
 */
export function pastGracePeriod(loan: DefaultCheckLoan, today: string): boolean {
  if (!["active", "extended", "reinstated"].includes(loan.status)) return false; // closed loans are skipped (reinstated loans default again: owner decision on Matt #3)
  if (loan.archived_at) return false; // archived loans are skipped
  return today > addDaysIso(loan.maturity_date, Number(loan.grace_period_days ?? 0)); // ISO dates compare as text
}

/**
 * L30 + A1: true when the database's default check would mark this loan Defaulted today.
 * Same rule as ctm_default_detection_core (migration 0020): past the grace period AND it still owes money
 * (stored principal or interest above 0). A fully paid loan is skipped since Matt's fix #1.
 */
export function wouldBeDefaulted(loan: DefaultCheckLoan, today: string): boolean {
  const owesMoney = Number(loan.principal_balance) > 0 || Number(loan.interest_owed) > 0; // same check as the database
  return pastGracePeriod(loan, today) && owesMoney; // both must be true
}

