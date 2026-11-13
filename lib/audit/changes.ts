// C10: works out WHAT changed in one audit entry, so the Audit trail can say "Status: Defaulted → Active"
// instead of only showing the whole record as raw data.
// Since Matt's fix #12 (migration 0021) every update saves the row before (old_data) and after (changed_data).
// Pure functions only (no database), so they're easy to test.
import { formatDate, formatDateTime, formatPeso, humanize } from "@/lib/format";
import { maskId } from "@/lib/customers/id-privacy"; // AT5: the same ID rule as the rest of the app

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

// AT2 (Matt, Nov 11): one line per column for the "View data" popup, so the Admin reads a table instead of raw data.
export type FieldRow = {
  key: string; // the column name
  label: string; // "Principal balance"
  before: string | null; // the old value, ready to show (null = no old row: a "Created" entry or an older entry)
  after: string; // the new value, ready to show
  changed: boolean; // true = different before and after
};

/** Every column of the entry, in the order of the new row. Changed columns are marked, "updated at" is left out. */
export function allFields(oldRow: unknown, newRow: unknown, names?: Map<string, string>): FieldRow[] {
  const isRow = (r: unknown): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r);
  if (!isRow(newRow)) return []; // nothing saved
  const old = isRow(oldRow) ? oldRow : null; // the row before, when it was saved
  const keys = [...new Set([...Object.keys(newRow), ...(old ? Object.keys(old) : [])])]; // every column in either row
  // AT3: short words in capitals ("ID number", "AML status")
  const label = (k: string) => humanize(k).replace(/\bId\b/g, "ID").replace(/\bid\b/g, "ID").replace(/\bAml\b/g, "AML").replace(/\baml\b/g, "AML");
  return keys
    .filter((k) => !SKIP.has(k)) // leave out "updated at"
    .sort((a, b) => label(a).localeCompare(label(b))) // AT3: A to Z, so a field is easy to find (the database keeps no useful order)
    .map((k) => ({
      key: k,
      label: label(k),
      before: old ? showValue(k, old[k], names) : null,
      after: showValue(k, newRow[k], names),
      changed: !!old && JSON.stringify(old[k] ?? null) !== JSON.stringify(newRow[k] ?? null),
    }));
}

// AT3 (Nov 12): fields a staff login can't read from the customer record, masked before an audit entry is shown.
// The database stops every staff login (Admins too) from reading customers.id_number, but saved customer rows in
// the audit log have it in full (470 entries), and the Audit trail's View data showed it. The stored audit log
// itself is not changed.
// AT5 (Nov 13): the database already masks these (audit_log_page, migrations 0066 + 0067); this is the second layer.
// Before: only the top level of an entry was masked, with its own "last 4 characters" rule. 2 Admin corrections
// keep the row inside "before" / "after", so their full numbers got through, and an ID of 4 characters or less
// was shown in full. Now: every level (objects and lists), with the app's own rule (lib/customers/id-privacy.ts:
// letters and digits only, "•••• 0418", 4 or less -> "••••").
const MASKED_FIELDS = new Set(["id_number"]);
export function maskSensitive<T>(row: T): T {
  if (Array.isArray(row)) return row.map((x) => maskSensitive(x)) as T; // a list: mask each item
  if (!row || typeof row !== "object") return row; // text, numbers, null: as they are
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (MASKED_FIELDS.has(k) && (typeof v === "string" || typeof v === "number") && v !== "")
      out[k] = String(v).startsWith("••••") ? v : maskId(String(v)); // already masked by the database: keep its last 4
    else out[k] = maskSensitive(v); // look inside (e.g. "before" / "after")
  }
  return out as T;
}

// AT3: which customer, loan, item or entry an audit entry is about, in words, from the saved row itself
// ("Juan Dela Cruz · C-0012", "PT-2026…", "A-0036"). Empty when the row has nothing readable.
const pad4 = (n: unknown) => String(n).padStart(4, "0");
export function affectedLabel(table: string, row: unknown): string {
  if (!row || typeof row !== "object") return "";
  const r = row as Record<string, unknown>;
  const has = (k: string) => r[k] !== null && r[k] !== undefined && r[k] !== "";
  switch (table) {
    case "customers":
      return [r.full_name, has("customer_no") ? `C-${pad4(r.customer_no)}` : ""].filter(Boolean).join(" · ");
    case "loans":
      return has("ticket_number") ? String(r.ticket_number) : "";
    case "appraisal_items":
      return has("appraisal_no") ? `A-${pad4(r.appraisal_no)}` : "";
    case "loan_payments":
      return has("receipt_number") ? `Receipt ${r.receipt_number}` : "";
    case "cash_flow_entries":
      return has("description") ? String(r.description) : "";
    case "inventory_items":
      return has("vault_location") ? `Vault: ${r.vault_location}` : "";
    case "profiles":
      return has("full_name") ? String(r.full_name) : "";
    case "suspicious_activity_flags":
      return has("reason") ? String(r.reason) : "";
    case "auction_batches":
      return has("batch_no") ? `AB-${pad4(r.batch_no)}` : "";
    default:
      return "";
  }
}
