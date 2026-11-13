import { isFullyPaid } from "@/lib/loans/status"; // F3: the shared "nothing left to pay" rule
// Item 6: customer history score. Weights live in the score_weights table so
// the owner can tune them; DEFAULT_WEIGHTS mirrors the seeded values.

export type ScoreWeights = {
  base: number;
  redeemed_on_time: number;
  renewal: number;
  renewal_cap: number;
  delinquent: number;
  reinstated: number;
  defaulted: number;
  currently_overdue: number;
  old_outcome_months: number;
  old_outcome_factor: number;
};

export const DEFAULT_WEIGHTS: ScoreWeights = {
  base: 60,
  redeemed_on_time: 8,
  renewal: 3,
  renewal_cap: 15,
  delinquent: -6,
  reinstated: -15,
  defaulted: -25,
  currently_overdue: -10,
  old_outcome_months: 24,
  old_outcome_factor: 0.5,
};

export function weightsFromRows(rows: { key: string; value: number }[] | null | undefined): ScoreWeights {
  const w = { ...DEFAULT_WEIGHTS };
  for (const row of rows ?? []) if (row.key in w) w[row.key as keyof ScoreWeights] = Number(row.value);
  return w;
}

export type ScoreLoan = {
  status: string;
  // F3: needed to tell a fully paid loan apart from an unpaid one. Optional so older callers still work
  // (without them a loan past its due date is treated as unpaid, the old behaviour).
  principal_balance?: number;
  interest_owed?: number;
  interest_rate_percent?: number;
  interest_accrued_through?: string | null;
  // LD (0073): liquidated damages (optional like the balances above; missing = none)
  grace_period_days?: number;
  liquidated_damages_percent?: number;
  damages_owed?: number;
  damages_accrued_through?: string | null;
  loan_date: string;
  maturity_date: string;
  extension_count: number;
  late_payment_count: number;
  defaulted_at: string | null;
  reinstated_at: string | null;
  redeemed_at: string | null;
};

export type HistoryCounts = {
  total: number;
  active: number;
  redeemed: number;
  renewed: number;
  delinquent: number;
  reinstated: number;
  defaulted: number;
  overdue: number;
};

export type Tier = "Excellent" | "Good" | "Fair" | "Risky";

export type CustomerScore = {
  counts: HistoryCounts;
  /** null when the customer has no loans: show "No history", not a score. */
  score: number | null;
  tier: Tier | null;
  /** True when any delinquency, reinstatement, or default exists. */
  hasWarnings: boolean;
};

const OPEN = new Set(["active", "extended", "reinstated"]);

// F3: true when the loan's balance is known and nothing is left to pay (shared rule in lib/loans/status.ts)
function paidInFull(loan: ScoreLoan, today: string): boolean {
  if (loan.principal_balance === undefined || loan.interest_owed === undefined || loan.interest_rate_percent === undefined) return false; // balance unknown: treat as unpaid
  return isFullyPaid(
    {
      status: loan.status,
      maturity_date: loan.maturity_date,
      principal_balance: Number(loan.principal_balance),
      interest_owed: Number(loan.interest_owed),
      interest_rate_percent: Number(loan.interest_rate_percent),
      interest_accrued_through: loan.interest_accrued_through ?? null,
      grace_period_days: Number(loan.grace_period_days ?? 0),
      liquidated_damages_percent: Number(loan.liquidated_damages_percent ?? 0),
      damages_owed: Number(loan.damages_owed ?? 0),
      damages_accrued_through: loan.damages_accrued_through ?? null,
    },
    today,
  );
}

export function tierFor(score: number): Tier {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Fair";
  return "Risky";
}

function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso.slice(0, 10));
  const b = new Date(toIso.slice(0, 10));
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
}

/** Archived loans are passed in too: they count toward history on purpose. */
export function computeCustomerScore(loans: ScoreLoan[], today: string, weights: ScoreWeights = DEFAULT_WEIGHTS): CustomerScore {
  const counts: HistoryCounts = { total: 0, active: 0, redeemed: 0, renewed: 0, delinquent: 0, reinstated: 0, defaulted: 0, overdue: 0 };
  let points = 0;
  let renewalPoints = 0;

  for (const loan of loans) {
    counts.total += 1;
    const isOpen = OPEN.has(loan.status);
    const defaulted = Boolean(loan.defaulted_at) || loan.status === "defaulted" || loan.status === "forfeited";
    const outcomeDate = loan.redeemed_at ?? loan.defaulted_at ?? loan.loan_date;
    const factor = monthsBetween(outcomeDate, today) >= weights.old_outcome_months ? weights.old_outcome_factor : 1;

    if (isOpen) counts.active += 1;
    if (loan.status === "redeemed") counts.redeemed += 1;
    if (loan.extension_count > 0) counts.renewed += 1;
    if (loan.late_payment_count > 0) counts.delinquent += 1;
    if (loan.reinstated_at) counts.reinstated += 1;
    if (defaulted) counts.defaulted += 1;

    if (loan.status === "redeemed" && loan.late_payment_count === 0 && !defaulted) points += weights.redeemed_on_time * factor;
    renewalPoints += weights.renewal * loan.extension_count * factor;
    if (loan.late_payment_count > 0) points += weights.delinquent * factor;
    if (loan.reinstated_at) points += weights.reinstated * factor;
    if (defaulted) points += weights.defaulted * factor;
    // F3: "overdue now" (and its penalty) only when money is still owed. A paid loan waiting for its item to be
    // released is not overdue (same rule as the Dashboard's "Paid, ready to release").
    if (isOpen && loan.maturity_date.slice(0, 10) < today && !paidInFull(loan, today)) {
      counts.overdue += 1;
      points += weights.currently_overdue;
    }
  }

  const hasWarnings = counts.delinquent > 0 || counts.reinstated > 0 || counts.defaulted > 0;
  if (counts.total === 0) return { counts, score: null, tier: null, hasWarnings: false };

  const raw = weights.base + points + Math.min(renewalPoints, weights.renewal_cap);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { counts, score, tier: tierFor(score), hasWarnings };
}
