// SA6 (Nov 12, migration 0060): the Suspicious activity words and rules in one place (no database here, so they
// can be tested). The database decides every flag again in review_suspicious_flag(); these only decide what the
// screen shows.
import { customerNo } from "@/lib/ref-numbers"; // 12 -> "C-0012"
import { SUSPICIOUS_LOAN_COUNT_THRESHOLD, SUSPICIOUS_WINDOW_HOURS } from "./suspicious"; // PB-32: the rule's numbers (3 loans, 24 hours)

// one flag as suspicious_flag_page() returns it
export type FlagRow = {
  id: string;
  status: "open" | "investigating" | "dismissed" | "blacklisted";
  reason: string; // the full reason, exactly as recorded
  created_at: string; // when the flag was saved
  resolved_at: string | null; // when the last decision was saved (also set by "Mark investigating")
  resolved_by_name: string | null;
  resolution_notes: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_no: number | null;
  customer_blacklisted: boolean | null;
  blacklist_reason: string | null;
  loan_id: string | null; // the loan the flag was saved with
  ticket_number: string | null;
  loan_principal: number | null;
  loan_created_at: string | null;
  loan_status: string | null;
  rule_flag: boolean; // added by the automatic "many loans" rule
  loans_24h: number | null; // automatic rule only: loans the customer opened in the 24 hours up to the flag
  loans_24h_sum: number | null;
  // SA7 (migration 0062): more evidence, all read from the records
  customer_aml_status: string | null; // "clear" or "flagged"
  customer_id_type: string | null; // the kind of ID on file (the number is not sent to the page)
  lost_ticket_used: boolean | null; // the flagged loan was redeemed with the lost-ticket check
  loan_redeemed_at: string | null;
  lost_ticket_payment: { amount: number; at: string; receipt: string | null; by: string | null } | null;
  customer_loans: { total: number; active: number; redeemed: number; defaulted: number } | null;
  other_flags: number; // other flags on the same customer (not archived)
  other_flags_blacklisted: number; // of those, how many ended in Blacklisted
  history: FlagEvent[]; // from the audit log, oldest first
};

// one line of a flag's history (the audit log keeps every change, so an earlier note is never lost)
export type FlagEvent = { at: string; action: "INSERT" | "UPDATE" | string; status: string | null; note: string | null; by: string | null };
export type FlagCounts = { open: number; investigating: number; needs_review: number; resolved: number };
export type FlagPage = { counts: FlagCounts; rule_reason: string; total: number; page: number; size: number; rows: FlagRow[] };

// the automatic rule in create_pawn_loan flags a customer at 3 or more loans in 24 hours (PB-32 placeholder).
// The same numbers as lib/compliance/suspicious.ts, so there is one place to change them.
export const RULE_MIN_LOANS = SUSPICIOUS_LOAN_COUNT_THRESHOLD;
export const RULE_WINDOW_HOURS = SUSPICIOUS_WINDOW_HOURS;

// the status, in words and a badge tone (amber = an Admin has to act, blue = being looked into)
export const FLAG_STATUS: Record<FlagRow["status"], { label: string; tone: "warning" | "info" | "neutral" | "danger" }> = {
  open: { label: "Open", tone: "warning" },
  investigating: { label: "Investigating", tone: "info" },
  dismissed: { label: "Dismissed", tone: "neutral" },
  blacklisted: { label: "Blacklisted", tone: "danger" },
};

// A short reason for the list. The full reason, as recorded, is shown in the review popup.
//   "Unusually high number of loans ... in a short window" -> "Many loans in a short time"
//   "Lost ticket used at redemption; ID checked against records" -> "Lost ticket used at redemption"
//   "High-value loan (PHP 30,950) for a customer with little history" -> "High-value loan (PHP 30,950)"
export function shortReason(reason: string, ruleReason?: string): string {
  const r = reason.trim();
  if (ruleReason && r === ruleReason) return "Many loans in a short time";
  const first = r.split(";")[0].replace(/\s+for a customer with little history$/i, "").trim();
  return first || r;
}

// "Demo Customer 01 · C-0012"
export const customerLabel = (f: Pick<FlagRow, "customer_name" | "customer_no">) =>
  [f.customer_name || "Unknown customer", customerNo(f.customer_no)].filter(Boolean).join(" · ");

// For the automatic rule: does the loan count in the records match the rule? (The 7 frequency flags in the shop's
// data show 1 or 2 loans; they were not made by the rule.)
export function ruleEvidence(f: Pick<FlagRow, "rule_flag" | "loans_24h">): "none" | "matches" | "below" {
  if (!f.rule_flag || f.loans_24h == null) return "none";
  return f.loans_24h >= RULE_MIN_LOANS ? "matches" : "below";
}

// what an Admin can do now, the same rule as the database
export function actionsFor(status: FlagRow["status"]): { investigate: boolean; dismiss: boolean; blacklist: boolean } {
  const active = status === "open" || status === "investigating";
  return { investigate: status === "open", dismiss: active, blacklist: active };
}

// the search and filter from the page address, cleaned (anything unknown is dropped)
export type FlagFilters = { view: "open" | "resolved"; q: string; status: "" | "open" | "investigating" };
export function flagFilters(sp: Record<string, string | undefined>): FlagFilters {
  const view = sp.view === "resolved" ? "resolved" : "open";
  return {
    view,
    q: (sp.q ?? "").trim().slice(0, 80),
    // the Open / Investigating filter only exists on Needs review
    status: view === "open" && (sp.status === "open" || sp.status === "investigating") ? sp.status : "",
  };
}

// SA7: a final decision (Dismiss or Blacklist) needs a written reason, the same rule as the database
// (SAD UC25: "Admin dismisses with documented reason"). Extra spaces don't count; it needs at least 10 characters
// and some letters, so "          " or ".........." is not a reason. Returns the problem in words, or null when it's fine.
export const REASON_MIN = 10;
export function cleanNote(note: string): string {
  return note.trim().replace(/\s+/g, " ");
}
export function reasonProblem(note: string): string | null {
  const n = cleanNote(note);
  if (!n) return "Write the reason for this decision.";
  if (n.length < REASON_MIN || !/\p{L}/u.test(n)) return `Write a bit more: at least ${REASON_MIN} characters saying why.`;
  if (n.length > 500) return "Keep the note to 500 characters or less.";
  return null;
}

// how the flag was raised, in words (the rule, or a reason that came with the records)
export function flagSource(f: Pick<FlagRow, "rule_flag">): string {
  return f.rule_flag ? "Automatic rule (many loans in a short time)" : "Recorded reason (not made by a rule in this system)";
}

// one history line in words: "Flag recorded", "Marked investigating", "Dismissed", "Blacklisted", "Note changed",
// or "Details updated" (a save that changed neither the status nor the note, e.g. who and when on old sample rows)
export function eventLabel(e: Pick<FlagEvent, "action" | "status" | "note">, prev: Pick<FlagEvent, "status" | "note"> | null): string {
  if (e.action === "INSERT") return e.status && e.status !== "open" ? `Recorded as ${FLAG_STATUS[e.status as FlagRow["status"]]?.label ?? e.status}` : "Flag recorded";
  if (e.status && e.status !== (prev?.status ?? null)) {
    if (e.status === "investigating") return "Marked investigating";
    return FLAG_STATUS[e.status as FlagRow["status"]]?.label ?? e.status;
  }
  return (e.note ?? null) !== (prev?.note ?? null) ? "Note changed" : "Details updated";
}
