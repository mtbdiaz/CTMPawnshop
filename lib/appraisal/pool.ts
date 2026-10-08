// Item 4: which appraisals can be pawned. The database enforces the same
// rules in create_pawn_loan; this keeps the picker from offering others.
export type PoolCandidate = {
  status: string;
  archived_at: string | null;
  is_counterfeit_risk: boolean;
  counterfeit_resolution: string | null;
};

export function isPawnable(a: PoolCandidate): boolean {
  if (a.status !== "available" || a.archived_at) return false;
  if (a.is_counterfeit_risk && a.counterfeit_resolution !== "cleared") return false;
  return true;
}
