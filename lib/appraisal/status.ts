// A1: one place that decides what an appraisal's badge says, so the list, the
// detail page and the New Loan picker never disagree. It only reads the
// columns the database already has. No new statuses are stored.

export type AppraisalStateInput = {
  status: string; // "available" or "pawned" (from the database)
  archived_at: string | null; // set when the appraisal was archived
  is_counterfeit_risk: boolean; // true when the appraiser flagged the item
  counterfeit_resolution: string | null; // "pending", "cleared" or "confirmed" (null when never flagged)
};

export type AppraisalState = {
  key: "archived" | "pawned" | "review" | "confirmed" | "available"; // what the item is right now
  label: string; // the words on the badge
  badge: string; // the StatusBadge status, which picks the color
  loanable: boolean; // true only when a Cashier may issue a loan against it
};

export function appraisalState(a: AppraisalStateInput): AppraisalState {
  if (a.archived_at) return { key: "archived", label: "Archived", badge: "neutral", loanable: false }; // archived items are out of every list
  if (a.status !== "available") return { key: "pawned", label: "Pawned", badge: "pawned", loanable: false }; // a loan was already issued against it
  if (a.is_counterfeit_risk && a.counterfeit_resolution === "confirmed") {
    return { key: "confirmed", label: "Confirmed risk", badge: "confirmed", loanable: false }; // an Admin confirmed the risk: never pawnable
  }
  if (a.is_counterfeit_risk && a.counterfeit_resolution !== "cleared") {
    return { key: "review", label: "Counterfeit review", badge: "pending", loanable: false }; // flagged and still waiting for an Admin
  }
  return { key: "available", label: "Available", badge: "available", loanable: true }; // no flag, or the flag was cleared
}
