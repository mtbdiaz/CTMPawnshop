// PB-39: concrete metrics chosen for the Trends & Analytics Dashboard
// (the story was flagged not Testable as written — "spot patterns" is
// subjective — so these are the objective, verifiable metrics it's built
// against; see DECISIONS_LOG.md).

export type LoanRecord = {
  principal_amount: number;
  status: "active" | "extended" | "redeemed" | "defaulted" | "forfeited";
  loan_date: string; // YYYY-MM-DD
};

const CONCLUDED_STATUSES = ["redeemed", "defaulted", "forfeited"] as const;

/** Redemption rate = redeemed / concluded loans (redeemed + defaulted + forfeited). */
export function computeRedemptionRate(loans: LoanRecord[]): number {
  const concluded = loans.filter((l) => (CONCLUDED_STATUSES as readonly string[]).includes(l.status));
  if (concluded.length === 0) return 0;
  const redeemed = concluded.filter((l) => l.status === "redeemed").length;
  return round4(redeemed / concluded.length);
}

/** Forfeiture rate = (defaulted + forfeited) / concluded loans. */
export function computeForfeitureRate(loans: LoanRecord[]): number {
  const concluded = loans.filter((l) => (CONCLUDED_STATUSES as readonly string[]).includes(l.status));
  if (concluded.length === 0) return 0;
  const forfeited = concluded.filter((l) => l.status === "defaulted" || l.status === "forfeited").length;
  return round4(forfeited / concluded.length);
}

export function computeAverageLoanSize(loans: LoanRecord[]): number {
  if (loans.length === 0) return 0;
  const total = loans.reduce((sum, l) => sum + l.principal_amount, 0);
  return round2(total / loans.length);
}

export type MonthlyVolume = { month: string; count: number; totalPrincipal: number };

/** Groups loans by loan_date's YYYY-MM, sorted chronologically. */
export function computeMonthlyVolume(loans: LoanRecord[]): MonthlyVolume[] {
  const byMonth = new Map<string, MonthlyVolume>();
  for (const loan of loans) {
    const month = loan.loan_date.slice(0, 7);
    const existing = byMonth.get(month) ?? { month, count: 0, totalPrincipal: 0 };
    existing.count += 1;
    existing.totalPrincipal = round2(existing.totalPrincipal + loan.principal_amount);
    byMonth.set(month, existing);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}
