// Physical audit rules in one place (no database here, so they can be tested).
// AS1 (Nov 11, migration 0044): an audit is a saved session. Every expected item has ONE of four results:
//   Not checked (nobody looked yet, the starting value), Found, Found elsewhere (it is in the shop but in the
//   wrong place) and Not located. "Not checked" is never the same as missing.

// PB-25: count physical-audit discrepancies (items not found where expected). Kept for the older audits.
export function countDiscrepancies(items: { found: boolean }[]): number {
  return items.filter((item) => !item.found).length;
}

// what a person can pick for an item. "not_checked" is saved as "no result" in the database
export type AuditResult = "not_checked" | "found" | "found_elsewhere" | "not_located";

// the words on the buttons and badges, in the order they are shown
export const AUDIT_RESULTS: { value: AuditResult; label: string }[] = [
  { value: "not_checked", label: "Not checked" },
  { value: "found", label: "Found" },
  { value: "found_elsewhere", label: "Found elsewhere" },
  { value: "not_located", label: "Not located" },
];

export const resultLabel = (r: string | null | undefined) => AUDIT_RESULTS.find((x) => x.value === (r ?? "not_checked"))?.label ?? "Not checked";

// why an item could not be located (the same list the database accepts)
export const AUDIT_REASONS: { value: string; label: string }[] = [
  { value: "not_at_location", label: "Not at its expected place" },
  { value: "label_mismatch", label: "The label or tag does not match" },
  { value: "details_mismatch", label: "The item's details do not match (weight, karat, look)" },
  { value: "other", label: "Other (write it in the note)" },
];

export const reasonLabel = (r: string | null | undefined) => AUDIT_REASONS.find((x) => x.value === r)?.label ?? "";

// the numbers of one audit, for the WHOLE audit (not only the rows on the screen)
export type AuditCounts = {
  expected: number; // items on the list when the audit started
  found: number;
  found_elsewhere: number;
  not_located: number;
  not_checked: number; // still to check (items that left the shop since the start are not counted here)
  left: number; // not checked and no longer in the shop (released or sold after the audit started)
  prior: number; // items with an open problem from an earlier audit
  prior_found_now: number; // of those, how many were found in this audit
  new_findings: number; // problems in this audit on items that had no open problem before
};

/** How many items have a result, out of how many need one, and the percent for the progress bar. */
export function auditProgress(c: Pick<AuditCounts, "found" | "found_elsewhere" | "not_located" | "not_checked">) {
  const checked = c.found + c.found_elsewhere + c.not_located; // a result was picked
  const total = checked + c.not_checked; // everything that needs a result
  return { checked, total, percent: total === 0 ? 100 : Math.floor((checked / total) * 100) }; // floor: 100% only when really done
}

/** The counts after ONE item changes from one result to another, so the screen updates right away. */
export function moveCount<T extends Pick<AuditCounts, "found" | "found_elsewhere" | "not_located" | "not_checked">>(c: T, from: AuditResult, to: AuditResult): T {
  if (from === to) return c;
  const next = { ...c };
  next[from] = Math.max(0, next[from] - 1); // one less of the old result
  next[to] = next[to] + 1; // one more of the new result
  return next;
}

/**
 * Checks what a person entered for one item BEFORE it is sent. Returns the first problem in plain words, or null.
 * The database checks the same things again (record_audit_result).
 */
export function auditResultProblem(result: AuditResult, reason: string, note: string, place: string): string | null {
  if (note.trim().length > 500) return "Keep the note to 500 characters or less.";
  if (result === "not_located") {
    if (!AUDIT_REASONS.some((r) => r.value === reason)) return "Pick a reason.";
    if (reason === "other" && note.trim().length < 5) return "Write what you saw in the note (at least 5 characters).";
  }
  if (result === "found_elsewhere") {
    const p = place.trim();
    if (p.length < 2) return "Write where the item was found.";
    if (p.length > 120) return "Keep the place to 120 characters or less.";
  }
  return null;
}

// the name of an audit's scope: one vault location, or all of them
export const scopeLabel = (scope: string | null | undefined) => scope || "All locations";

// one row of the audit checklist, as the database sends it (audit_session_page, migration 0045)
export type AuditRow = {
  id: string; // the audit line
  version: number; // goes up by one on every save (used to stop two people overwriting each other)
  result: Exclude<AuditResult, "not_checked"> | null; // null = Not checked
  reason: string | null;
  notes: string | null;
  found_location: string | null;
  checked_at: string | null;
  checked_by_name: string | null;
  expected_vault: string | null; // where it should be (saved when the audit started); null on audits from before 0044
  current_vault: string | null; // where the system says it is now
  item_status: string; // the item's custody status now
  in_custody: boolean; // false = released or sold after the audit started
  appraisal_item_id: string | null;
  appraisal_no: number | null;
  category: string | null;
  category_other: string | null;
  karat: number | null;
  weight_grams: number | null;
  condition_notes: string | null;
  photo_count: number;
  customer_name: string | null;
  ticket_number: string | null;
  loan_status: string | null;
  prior_result: string | null; // the item in an earlier audit (history only)
  prior_at: string | null;
  prior_open: boolean; // true = that earlier problem is not followed up yet
};

// what one audit page gets from the database
export type AuditPage = {
  audit: {
    id: string;
    status: "in_progress" | "submitted";
    scope_vault: string | null;
    started_at: string;
    submitted_at: string | null;
    is_partial: boolean;
    expected_count: number | null;
    notes: string | null;
    started_by: string | null;
    submitted_by: string | null;
  };
  counts: AuditCounts & { checkers: string[] | null };
  vaults: { vault: string | null; n: number }[];
  total: number; // rows that match the filters
  page: number;
  size: number;
  rows: AuditRow[];
};

// the views (tabs) of the checklist
export const AUDIT_VIEWS = ["all", "not_checked", "found", "not_located", "found_elsewhere", "prior", "left"] as const;
export type AuditView = (typeof AUDIT_VIEWS)[number];
export const auditView = (v: string | undefined): AuditView => (AUDIT_VIEWS as readonly string[]).includes(v ?? "") ? (v as AuditView) : "all";

// rows per page the person can pick (the database allows 5 to 50)
export const AUDIT_PAGE_SIZES = [10, 25, 50];
export const auditPageSize = (v: string | undefined) => (AUDIT_PAGE_SIZES.includes(Number(v)) ? Number(v) : 10);

/* ---------- AD1 (migration 0046): following up a problem after the audit ---------- */

// what a person can answer when they check a problem item again.
// closes = the follow-up is finished; saw = the person says they saw the item (needs the confirm tick).
// 0047: "Found at another location" does NOT close it: the item is not missing, but it is still not where the
// system says, and the app has no screen to move an item. It closes when the item is back at its recorded place.
export const FOLLOWUP_OUTCOMES: { value: string; label: string; closes: boolean; saw: boolean; hint: string }[] = [
  { value: "found_expected", label: "At its recorded location (found there, or put back)", closes: true, saw: true, hint: "Closes this follow-up" },
  { value: "found_elsewhere", label: "Found at another location", closes: false, saw: true, hint: "Stays on the list until it is back at its recorded location" },
  { value: "still_not_located", label: "Still not located", closes: false, saw: false, hint: "Stays on the follow-up list" },
  { value: "escalated", label: "Escalate for investigation", closes: false, saw: false, hint: "Stays on the follow-up list" },
];

// the words for a saved check, in the history ("Escalated for investigation")
export const followupLabel = (o: string) =>
  ({ found_expected: "At its recorded location", found_elsewhere: "Found at another location", still_not_located: "Still not located", escalated: "Escalated for investigation" })[o] ?? o;

// one saved follow-up check
export type Followup = { outcome: string; found_location: string | null; notes: string; at: string; by: string | null; line_id?: string };

/**
 * Where an open problem stands now, from the audit's finding and the checks so far. The finding itself
 * (Not located / Found elsewhere) is a different thing and never changes.
 */
export function followupStatus(checks: { outcome: string }[], finding?: string): { label: string; tone: "warning" | "danger" | "neutral" } {
  const last = checks[checks.length - 1]?.outcome;
  if (last === "escalated") return { label: "Escalated", tone: "danger" };
  if (last === "still_not_located") return { label: "Under investigation", tone: "warning" };
  // seen, but in the wrong place: the system location and the real place still don't match
  if (last === "found_elsewhere" || (!last && finding === "found_elsewhere")) return { label: "Location to correct", tone: "warning" };
  return { label: "Pending verification", tone: "neutral" }; // nobody has checked again yet
}

/** Checks a follow-up before it is sent. Returns { field: problem } in plain words; empty = fine. */
export function followupProblems(outcome: string, notes: string, place: string, confirmed: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  const o = FOLLOWUP_OUTCOMES.find((x) => x.value === outcome);
  if (!o) e.outcome = "Pick what you found.";
  if (outcome === "found_elsewhere") {
    if (place.trim().length < 2) e.found_location = "Write where the item was found.";
    else if (place.trim().length > 120) e.found_location = "Keep the place to 120 characters or less.";
  }
  if (notes.trim().length < 10) e.notes = "Write what you checked and saw (at least 10 characters).";
  else if (notes.trim().length > 500) e.notes = "Keep the note to 500 characters or less.";
  if (o?.saw && !confirmed) e.confirm = "Tick the box to confirm you saw the item yourself."; // only the answers that say the item was seen
  return e;
}

/* ---------- AV1 (Nov 11): what an audit covered, and how much of that was checked ---------- */
// These are two different things, so they get two different labels:
//   scope = WHICH items the audit listed (one location, every location, or unknown for the audits made before
//           audit sessions existed: those saved a list of items but not what the list was)
//   done  = were all the listed items checked ("All checked") or not ("Partial")
// "Full" is not used: an audit of 7 listed items with all 7 checked is complete, but it is not a count of the vault.
export function auditCoverage(a: { scope_vault: string | null; started_at: string; submitted_at: string | null; expected_count: number | null; is_partial: boolean }) {
  const legacy = a.submitted_at !== null && a.started_at === a.submitted_at; // saved in one go by the old form
  const n = a.expected_count;
  const items = n === null ? "" : `${n.toLocaleString("en-PH")} ${n === 1 ? "item" : "items"}`;
  return {
    legacy,
    scope: legacy ? `Older audit${items ? `: ${items} listed` : ""} (scope not recorded)` : `${a.scope_vault ? `Location: ${a.scope_vault}` : "All locations"}${items ? ` · ${items} expected` : ""}`,
    done: a.is_partial ? "Partial" : "All listed items checked",
  };
}

// one row of the follow-up list (audit_followup_list)
export type FollowupRow = {
  id: string;
  audit_id: string;
  result: "not_located" | "found_elsewhere";
  reason: string | null;
  notes: string | null;
  found_location: string | null;
  audit_at: string;
  recorded_by: string | null;
  expected_vault: string | null;
  current_vault: string | null;
  item_status: string;
  appraisal_item_id: string | null;
  appraisal_no: number | null;
  category: string | null;
  category_other: string | null;
  karat: number | null;
  weight_grams: number | null;
  condition_notes: string | null;
  photo_count: number;
  customer_name: string | null;
  ticket_number: string | null;
  followups: Followup[];
};
