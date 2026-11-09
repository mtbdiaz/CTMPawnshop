// #18 + #29 (migration 0034): the short numbers staff can say and write down.
// The database keeps a plain number (customers.customer_no, appraisal_items.appraisal_no); the app adds the letter
// and zeros, so C-0012 / A-0045 look the same on every page and in every search.

/** 12 -> "C-0012" (customers). Bigger numbers just get longer: 12345 -> "C-12345". */
export const customerNo = (n: number | null | undefined) => (n ? `C-${String(n).padStart(4, "0")}` : "");
/** 45 -> "A-0045" (appraisals / items). */
export const appraisalNo = (n: number | null | undefined) => (n ? `A-${String(n).padStart(4, "0")}` : "");

/**
 * Reads a short number typed in a search box: "C-0012", "c12", "C 12" -> { kind: "C", n: 12 }; "A-45" -> { kind: "A", n: 45 }.
 * Anything else (a name, a phone, a ticket) -> null, so the normal search runs.
 */
export function parseRefNo(q: string | null | undefined): { kind: "C" | "A"; n: number } | null {
  const m = /^\s*([ca])[\s-]?0*(\d{1,9})\s*$/i.exec(q ?? "");
  if (!m) return null;
  const n = Number(m[2]);
  return n > 0 ? { kind: m[1].toUpperCase() as "C" | "A", n } : null;
}
