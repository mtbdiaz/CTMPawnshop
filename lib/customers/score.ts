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
    if (isOpen && loan.maturity_date.slice(0, 10) < today) {
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
