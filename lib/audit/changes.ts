// C10: works out WHAT changed in one audit entry, so the Audit trail can say "Status: Defaulted → Active"
// instead of only showing the whole record as raw data.
// Since Matt's fix #12 (migration 0021) every update saves the row before (old_data) and after (changed_data).
// Pure functions only (no database), so they're easy to test.
import { formatDate, formatDateTime, formatPeso, humanize } from "@/lib/format";

export type FieldChange = {
  key: string; // the column name, e.g. "principal_balance"
  label: string; // shown to people, e.g. "Principal balance"
  before: string; // the old value, ready to show
  after: string; // the new value, ready to show
};

// columns that change on almost every update and say nothing useful on their own
const SKIP = new Set(["updated_at"]);

// columns that hold money (shown as ₱1,234.00)
const MONEY = /(amount|balance|principal|interest_owed|computed_value|loan_max|price|capitalized)/;

// a database id, e.g. "4b0b7327-6f26-47ab-b2af-7a5dd031b948"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns one stored value into short readable text.
 * names = staff id -> name, used for "who" columns (e.g. appraised_by), so an id shows as a person's name.
 */
export function showValue(key: string, value: unknown, names?: Map<string, string>): string {
  if (value === null || value === undefined || value === "") return "(empty)"; // nothing saved
  if (typeof value === "boolean") return value ? "Yes" : "No"; // true / false
  if (typeof value === "number") return MONEY.test(key) ? formatPeso(value) : value.toLocaleString("en-PH"); // money or a plain number
  if (typeof value === "string") {
    if (key === "status" && value === "extended") return "Renewed"; // the app calls an extended loan "Renewed" everywhere
    if (UUID.test(value)) {
      const name = names?.get(value); // a staff member's id -> their name
      return name ?? `ID …${value.slice(-6)}`; // other ids: the last 6 characters are enough to tell them apart
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value); // a date, e.g. a due date
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDateTime(value); // a date and time
    if (MONEY.test(key) && value.trim() !== "" && !Number.isNaN(Number(value))) return formatPeso(value); // money saved as text
    if (value.length <= 30 && /^[a-z]+(_[a-z]+)*$/.test(value)) return humanize(value); // a short status word like "defaulted" -> "Defaulted"
    return value.length > 80 ? `${value.slice(0, 80)}…` : value; // long text is cut so the row stays short
  }
  const json = JSON.stringify(value); // lists or objects (rare)
  return json.length > 80 ? `${json.slice(0, 80)}…` : json;
}

/**
 * The columns that are different between the old and the new row, in the order of the new row.
 * Returns null when there is no old row to compare with (entries saved before Nov 6, 2026, or a "Created" entry).
 */
export function changedFields(oldRow: unknown, newRow: unknown, names?: Map<string, string>): FieldChange[] | null {
  const isRow = (r: unknown): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r);
  if (!isRow(oldRow) || !isRow(newRow)) return null; // nothing to compare
  const keys = [...new Set([...Object.keys(newRow), ...Object.keys(oldRow)])]; // every column in either row
  return keys
    .filter((k) => !SKIP.has(k)) // leave out "updated at"
    .filter((k) => JSON.stringify(oldRow[k] ?? null) !== JSON.stringify(newRow[k] ?? null)) // only the ones that changed
    .map((k) => ({ key: k, label: humanize(k), before: showValue(k, oldRow[k], names), after: showValue(k, newRow[k], names) }));
}
