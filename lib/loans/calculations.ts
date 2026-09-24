// Loan term & interest-cycle assumption (not specified in /docs — PB-6 calls
// the configurable rate a "monthly interest rate", which implies a 30-day
// cycle). Standard PH pawnshop convention: 30-day renewable term, one
// interest period due at maturity/extension. Documented in DECISIONS_LOG.md.
export const LOAN_TERM_DAYS = 30;

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function calculateMaturityDate(loanDate: Date, termDays: number = LOAN_TERM_DAYS): Date {
  return addDays(loanDate, termDays);
}

/** One interest period's charge on the current principal balance. */
export function calculateInterestDue(principalBalance: number, interestRatePercent: number): number {
  return round2(principalBalance * (interestRatePercent / 100));
}

export type PaymentBreakdown = {
  interestPortion: number;
  principalPortion: number;
  newPrincipalBalance: number;
};

// PB-18: interest is settled first, any remainder reduces principal.
export function applyPayment(
  amount: number,
  principalBalance: number,
  interestDue: number,
): PaymentBreakdown {
  const interestPortion = Math.min(amount, interestDue);
  const remainder = amount - interestPortion;
  const principalPortion = Math.min(remainder, principalBalance);

  return {
    interestPortion: round2(interestPortion),
    principalPortion: round2(principalPortion),
    newPrincipalBalance: round2(principalBalance - principalPortion),
  };
}

// PB-18 AC2: reject a payment exceeding the total balance owed.
export function validatePaymentAmount(
  amount: number,
  principalBalance: number,
  interestDue: number,
): { ok: boolean; error?: string } {
  if (amount <= 0) return { ok: false, error: "Payment amount must be greater than 0" };
  const totalOwed = round2(principalBalance + interestDue);
  if (amount > totalOwed) {
    return { ok: false, error: `Payment of ${amount} exceeds the total balance owed (${totalOwed})` };
  }
  return { ok: true };
}

export type ExtensionResult = {
  newMaturityDate: Date;
  additionalInterestAmount: number;
};

// PB-19: recalculate maturity date and additional interest for an extension.
export function calculateExtension(
  currentMaturityDate: Date,
  principalBalance: number,
  interestRatePercent: number,
  termDays: number = LOAN_TERM_DAYS,
): ExtensionResult {
  return {
    newMaturityDate: addDays(currentMaturityDate, termDays),
    additionalInterestAmount: calculateInterestDue(principalBalance, interestRatePercent),
  };
}

export type RenewalResult = ExtensionResult & {
  /** Interest still owed on the expiring period — collected at the counter. */
  interestCollectedNow: number;
  /** One fresh period's interest, owed by the new maturity date. */
  newInterestOwed: number;
};

// PB-19 as pay-and-renew: the customer settles whatever interest is still
// owed for the expiring period, and the loan starts a fresh period with one
// new period's interest owed. Interest is never both collected and left owing.
export function calculateRenewal(
  currentMaturityDate: Date,
  principalBalance: number,
  interestOwed: number,
  interestRatePercent: number,
  termDays: number = LOAN_TERM_DAYS,
): RenewalResult {
  const extension = calculateExtension(currentMaturityDate, principalBalance, interestRatePercent, termDays);
  return {
    ...extension,
    interestCollectedNow: round2(Math.max(0, interestOwed)),
    newInterestOwed: extension.additionalInterestAmount,
  };
}

export function generateTicketNumber(date: Date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `PT-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function generateReceiptNumber(date: Date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `RC-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
