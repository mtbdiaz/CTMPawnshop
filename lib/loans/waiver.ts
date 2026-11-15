// Waiving a penalty (migration 0078). The "penalty" is the liquidated damages of migration 0073.
// An Admin may waive all or part of it, for a written reason, when the customer could not pay or renew because of
// something outside their control (the shop was closed, the system was down). Nothing is ever waived automatically.
// Pure functions only (no database), so they are easy to test. The database is the real check (waive_penalty()).

export const WAIVER_REASONS = [
  { value: "shop_closed", label: "Pawnshop closed on the customer's due date" },
  { value: "business_closure", label: "Unexpected business closure" },
  { value: "system_downtime", label: "System downtime or technical issues" },
  { value: "other", label: "Other circumstances beyond the customer's control" },
] as const;

export type WaiverReason = (typeof WAIVER_REASONS)[number]["value"];

export function isWaiverReason(value: unknown): value is WaiverReason {
  return WAIVER_REASONS.some((r) => r.value === value);
}

/** The words for a saved reason code (an unknown code is shown as it is, so nothing is hidden). */
export function waiverReasonLabel(code: string): string {
  return WAIVER_REASONS.find((r) => r.value === code)?.label ?? code;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What waiving `amount` of a penalty of `penalty` would do to what the customer owes to redeem (`owed`).
 * `amount` null or empty = the whole penalty. Mirrors waive_penalty(): more than the penalty, or 0, is an error.
 */
export function waiverPreview(
  penalty: number,
  owed: number,
  amount: number | null,
): { error: string | null; waive: number; penaltyAfter: number; owedAfter: number } {
  const waive = amount === null ? round2(penalty) : round2(amount);
  if (penalty <= 0) return { error: "No penalty is owed on this loan.", waive: 0, penaltyAfter: 0, owedAfter: round2(owed) };
  if (!Number.isFinite(waive) || waive <= 0 || waive > round2(penalty)) {
    return { error: `Enter more than 0 and not more than the penalty owed (${round2(penalty).toFixed(2)}).`, waive: 0, penaltyAfter: round2(penalty), owedAfter: round2(owed) };
  }
  return { error: null, waive, penaltyAfter: round2(penalty - waive), owedAfter: round2(owed - waive) };
}
