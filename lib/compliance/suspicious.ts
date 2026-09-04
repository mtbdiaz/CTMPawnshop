// PB-32: placeholder AML rule-based detection (no real AML pattern
// engine/provider available — see DECISIONS_LOG.md). Flags a customer
// opening an unusually high number of loans in a short window, a common
// "structuring" red flag.
export const SUSPICIOUS_LOAN_COUNT_THRESHOLD = 3;
export const SUSPICIOUS_WINDOW_HOURS = 24;

export function isSuspiciousLoanVelocity(loanTimestamps: Date[], now: Date = new Date()): boolean {
  const windowStart = new Date(now.getTime() - SUSPICIOUS_WINDOW_HOURS * 3_600_000);
  const recentCount = loanTimestamps.filter((t) => t >= windowStart && t <= now).length;
  return recentCount >= SUSPICIOUS_LOAN_COUNT_THRESHOLD;
}
