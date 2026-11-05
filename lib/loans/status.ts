// F3: ONE place that decides "paid" vs "overdue", so the Dashboard, Loans, the customer profile and the
// customer score all use the same rule. Before this, a loan that was fully paid but whose item wasn't released
// yet still counted as "Overdue" in some places (and cost the customer 10 score points).
import { accruedInterest, type AccrualLoan } from "./accrual"; // the same interest math the loan page uses

// loans that are still running (not redeemed, defaulted or forfeited)
export const OPEN_STATUSES = new Set(["active", "extended", "reinstated"]);

// what the customer owes today: principal left + interest, including interest after the due date (same as the Dashboard)
export function owedNow(loan: AccrualLoan, today: string): number {
  const total = Number(loan.principal_balance) + accruedInterest(loan, today).interestOwed; // principal + interest
  return Math.round(total * 100) / 100; // rounded to centavos, so tiny decimal leftovers don't count
}

// true when nothing is left to pay. "Less than 1 centavo" instead of "equals 0" because adding decimals
// can leave tiny leftovers like 0.0000001 (same rule as the Dashboard's "Paid, ready to release")
export function isFullyPaid(loan: AccrualLoan, today: string): boolean {
  return owedNow(loan, today) < 0.01;
}

// true only for a loan that is still running, past its due date, AND still owes money.
// A paid loan waiting for the item to be released is NOT overdue.
export function isOverdueUnpaid(loan: AccrualLoan, today: string): boolean {
  if (!OPEN_STATUSES.has(loan.status)) return false; // closed or defaulted: not "overdue" in this sense
  if (loan.maturity_date.slice(0, 10) >= today) return false; // not past the due date yet
  return !isFullyPaid(loan, today); // past due: overdue only if money is still owed
}
