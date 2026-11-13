// AT7 (Nov 13): turns one audit entry into words an Admin can read at a glance:
// WHAT happened (the title and one plain-language line), WHICH record (PT- / C- / A- / RC- / AB- references),
// and WHY (the reason, when one was saved). WHO and WHEN come straight from the entry.
// Pure functions only (no database), so they're easy to test. Nothing here changes an entry.
import { formatDate, formatPeso, humanize } from "@/lib/format";
import { changedFields, type FieldChange } from "./changes";
import { entryTypeLabel } from "@/lib/finance/ledger";
import { CUSTODY } from "@/lib/inventory/custody";
import { stateBadge } from "@/lib/loans/display";

export type AuditAction = "INSERT" | "UPDATE" | "DELETE" | "VIEW";

// AT7: one word per action, the same everywhere on the page (the badge, the Action filter, the popup title)
export const ACTION_WORD: Record<AuditAction, string> = { INSERT: "Created", UPDATE: "Updated", DELETE: "Deleted", VIEW: "Viewed" };
export const ACTION_TONE: Record<AuditAction, "success" | "info" | "danger" | "neutral"> = { INSERT: "success", UPDATE: "info", DELETE: "danger", VIEW: "neutral" };

// the record types in the order of the Record type filter: [table, one record, the list]
export const RECORD_TYPES: [string, string, string][] = [
  ["customers", "Customer", "Customers"],
  ["appraisal_items", "Appraisal", "Appraisals"],
  ["loans", "Loan", "Loans"],
  ["loan_payments", "Payment", "Payments"],
  ["loan_extensions", "Renewal", "Renewals"],
  ["inventory_items", "Inventory item", "Inventory items"],
  ["inventory_status_history", "Inventory status", "Inventory status changes"],
  ["cash_flow_entries", "Cash entry", "Cash entries"],
  ["physical_inventory_audits", "Physical audit", "Physical audits"],
  ["physical_inventory_audit_items", "Audit line", "Physical audit lines"],
  ["physical_inventory_audit_followups", "Audit follow-up", "Physical audit follow-ups"],
  ["auction_batches", "Auction batch", "Auction batches"],
  ["auction_batch_items", "Auction batch item", "Auction batch items"],
  ["suspicious_activity_flags", "Suspicious-activity flag", "Suspicious-activity flags"],
  ["reminder_log", "Reminder", "Reminders"],
  ["profiles", "Staff account", "Staff accounts"],
  ["system_settings", "Shop settings", "Shop settings"],
];
const ONE = new Map(RECORD_TYPES.map(([t, one]) => [t, one]));
export const recordName = (table: string) => ONE.get(table) ?? humanize(table);

// the stored entry as the page receives it (ID numbers already masked by the database)
export type AuditEvent = {
  table_name: string;
  record_id: string;
  action: string;
  changed_data: unknown;
  old_data: unknown;
};

type Row = Record<string, unknown>;
const isRow = (r: unknown): r is Row => !!r && typeof r === "object" && !Array.isArray(r);
const str = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));
const pad4 = (n: unknown) => String(n).padStart(4, "0");

/** An Admin correction saves { admin_edit, reason, before, after } instead of the plain row. */
export function adminEdit(e: AuditEvent): { reason: string; before: Row | null; after: Row | null } | null {
  const d = e.changed_data;
  if (!isRow(d) || !d.admin_edit) return null;
  return { reason: str(d.reason), before: isRow(d.before) ? d.before : null, after: isRow(d.after) ? d.after : null };
}

/** The row as it is after this event (for a correction: its "after"; for a delete: the old row). */
export function rowOf(e: AuditEvent): Row {
  const edit = adminEdit(e);
  if (edit) return edit.after ?? {};
  if (isRow(e.changed_data)) return e.changed_data;
  return isRow(e.old_data) ? e.old_data : {};
}

/** The changes of an update (or a correction), or null when the row before wasn't saved (entries before Nov 6, 2026). */
export function eventChanges(e: AuditEvent, names?: Map<string, string>): FieldChange[] | null {
  const edit = adminEdit(e);
  if (edit) return changedFields(edit.before, edit.after, names);
  if (e.action !== "UPDATE") return null;
  return changedFields(e.old_data, e.changed_data, names);
}

// the changes an Admin cares about most, first (status before amounts before dates before the rest)
const IMPORTANT = ["status", "is_blacklisted", "aml_status", "principal_balance", "interest_owed", "damages_owed", "maturity_date", "vault_location", "archived_at", "batch_no", "role", "is_active", "result", "resolution_outcome"];
function ranked(changes: FieldChange[]): FieldChange[] {
  const rank = (k: string) => (IMPORTANT.includes(k) ? IMPORTANT.indexOf(k) : IMPORTANT.length);
  return [...changes].sort((a, b) => rank(a.key) - rank(b.key));
}

// a status word in the app's own words ("extended" -> "Renewed", "queued_for_auction" -> "Queued for auction")
function statusWord(table: string, v: unknown): string {
  const s = str(v);
  if (!s) return "(none)";
  if (table === "loans") return stateBadge(s).label;
  if (table === "inventory_items" || table === "inventory_status_history") return CUSTODY[s as keyof typeof CUSTODY]?.label ?? humanize(s);
  return humanize(s);
}

/** The event's title, e.g. "Loan status updated", "Payment recorded", "Customer ID number viewed". */
export function eventTitle(e: AuditEvent): string {
  const name = recordName(e.table_name);
  if (adminEdit(e)) return `${name} corrected by an Admin`;
  if (e.action === "VIEW") return rowOf(e).field === "id_number" ? `${name} ID number viewed` : `${name} record viewed`;
  if (e.action === "INSERT") {
    if (e.table_name === "loan_payments") return "Payment recorded";
    if (e.table_name === "loan_extensions") return "Loan renewed";
    if (e.table_name === "inventory_status_history") return "Inventory status recorded";
    if (e.table_name === "cash_flow_entries") return "Cash entry recorded";
    if (e.table_name === "customers") return "Customer registered";
    return `${name} created`;
  }
  if (e.action === "DELETE") return `${name} deleted`;
  // an update: name the most important change when it's the status
  const top = ranked(eventChanges(e) ?? [])[0];
  if (top?.key === "status") return `${name} status updated`;
  if (top?.key === "archived_at") return rowOf(e).archived_at ? `${name} archived` : `${name} restored`;
  return `${name} updated`;
}

/** One plain-language line about what happened, e.g. "Active → Defaulted" or "₱500.00 payment". */
export function eventSummary(e: AuditEvent, names?: Map<string, string>): string {
  const r = rowOf(e);
  if (e.action === "VIEW") return r.field === "id_number" ? "The full ID number was shown on screen" : "The record was opened";
  if (e.action === "DELETE") return "The record was deleted";
  const changes = eventChanges(e, names);
  if (adminEdit(e) || e.action === "UPDATE") {
    if (changes === null) return "Older entry: only the new values were saved";
    if (changes.length === 0) return "No visible change (only the update time)";
    const [top, ...rest] = ranked(changes);
    const line = top.key === "status" ? `${statusWord(e.table_name, rowOfBefore(e).status)} → ${statusWord(e.table_name, r.status)}` : `${top.label}: ${top.before} → ${top.after}`;
    return rest.length ? `${line} (+${rest.length} more)` : line;
  }
  // a new record: its key facts
  switch (e.table_name) {
    case "loans":
      return [r.principal_amount != null ? `${formatPeso(Number(r.principal_amount))} principal` : "", r.maturity_date ? `due ${formatDate(str(r.maturity_date))}` : ""].filter(Boolean).join(" · ") || "New loan";
    case "loan_payments":
      return r.amount != null ? `${formatPeso(Number(r.amount))} payment${r.verified_via_lost_ticket ? " (lost ticket, ID checked)" : ""}` : "Payment";
    case "loan_extensions":
      return r.previous_maturity_date && r.new_maturity_date ? `Due date ${formatDate(str(r.previous_maturity_date))} → ${formatDate(str(r.new_maturity_date))}` : "Loan renewed";
    case "cash_flow_entries":
      return `${entryTypeLabel(str(r.entry_type))} · ${formatPeso(Number(r.amount ?? 0))} ${r.is_memo ? "(no cash moved)" : r.direction === "in" ? "in" : "out"}`;
    case "inventory_status_history":
      return `${r.old_status ? statusWord(e.table_name, r.old_status) : "New item"} → ${statusWord(e.table_name, r.new_status)}`;
    case "inventory_items":
      return r.vault_location ? `Received into ${str(r.vault_location)}` : "Received";
    case "appraisal_items":
      return [r.karat ? `${r.karat}K` : "", r.weight_grams ? `${r.weight_grams} g` : "", r.computed_value != null ? `value ${formatPeso(Number(r.computed_value))}` : ""].filter(Boolean).join(" · ") || "New appraisal";
    case "suspicious_activity_flags":
      return str(r.reason) || "New flag";
    case "physical_inventory_audits":
      return `Audit started for ${str(r.scope_vault) || "all vaults"}`;
    case "profiles":
      return [str(r.full_name), r.role ? humanize(str(r.role)) : ""].filter(Boolean).join(" · ") || "New staff account";
    default:
      return "New record";
  }
}

function rowOfBefore(e: AuditEvent): Row {
  const edit = adminEdit(e);
  if (edit) return edit.before ?? {};
  return isRow(e.old_data) ? e.old_data : {};
}

/** WHY: the reason saved with the event (an Admin correction, an ID view, an archive), or "". */
export function eventReason(e: AuditEvent): string {
  const edit = adminEdit(e);
  if (edit) return edit.reason;
  const r = rowOf(e);
  if (e.action === "VIEW") return str(r.reason);
  if (e.action === "UPDATE" && r.archived_at && !rowOfBefore(e).archived_at) return str(r.archive_reason);
  return "";
}

/** "View changes" when there is a before and after to compare, otherwise "View details". */
export function detailsLabel(e: AuditEvent): "View changes" | "View details" {
  return eventChanges(e) !== null ? "View changes" : "View details";
}

// ---------- WHICH record: readable references ----------

/** The other records the page looks up so it can show references (only these columns are read; never ID numbers). */
export type RefLookups = {
  loans: Map<string, { ticket_number: string; customer_id: string | null }>;
  customers: Map<string, { customer_no: number | null; full_name: string | null }>;
  appraisals: Map<string, { appraisal_no: number | null }>;
  items: Map<string, { appraisal_item_id: string | null }>;
  batches: Map<string, { batch_no: number | null }>;
};

/** The ids of the linked records a page of events needs, grouped by table. */
export function refIds(events: AuditEvent[]): { loans: string[]; customers: string[]; appraisals: string[]; items: string[]; batches: string[] } {
  const ids = { loans: new Set<string>(), customers: new Set<string>(), appraisals: new Set<string>(), items: new Set<string>(), batches: new Set<string>() };
  const add = (set: Set<string>, v: unknown) => {
    const s = str(v);
    if (/^[0-9a-f-]{36}$/i.test(s)) set.add(s);
  };
  for (const e of events) {
    const r = rowOf(e);
    if (e.table_name === "loans") add(ids.loans, e.record_id);
    if (e.table_name === "customers") add(ids.customers, e.record_id);
    if (e.table_name === "appraisal_items") add(ids.appraisals, e.record_id);
    if (e.table_name === "inventory_items") add(ids.items, e.record_id);
    if (e.table_name === "auction_batches") add(ids.batches, e.record_id);
    add(ids.loans, r.loan_id);
    add(ids.loans, r.related_loan_id);
    add(ids.customers, r.customer_id);
    add(ids.appraisals, r.appraisal_item_id);
    add(ids.items, r.inventory_item_id);
    add(ids.batches, r.batch_id);
  }
  return { loans: [...ids.loans], customers: [...ids.customers], appraisals: [...ids.appraisals], items: [...ids.items], batches: [...ids.batches] };
}

const cNo = (n: unknown) => (n === null || n === undefined || n === "" ? "" : `C-${pad4(n)}`);
const aNo = (n: unknown) => (n === null || n === undefined || n === "" ? "" : `A-${pad4(n)}`);
const abNo = (n: unknown) => (n === null || n === undefined || n === "" ? "" : `AB-${pad4(n)}`);

/**
 * WHICH record, in references people use: { main: "PT-2026…-829B", sub: "C-0339 · Juan Dela Cruz" }.
 * main is "" when nothing readable is known; the record ID is always in the popup.
 */
export function recordRef(e: AuditEvent, lk: RefLookups): { main: string; sub: string } {
  const r = rowOf(e);
  const ticket = (id: unknown) => lk.loans.get(str(id))?.ticket_number ?? "";
  const customer = (id: unknown) => {
    const c = lk.customers.get(str(id));
    return c ? [cNo(c.customer_no), str(c.full_name)].filter(Boolean).join(" · ") : "";
  };
  const appraisalOfItem = (id: unknown) => {
    const it = lk.items.get(str(id));
    return it ? aNo(lk.appraisals.get(str(it.appraisal_item_id))?.appraisal_no) : "";
  };
  switch (e.table_name) {
    case "customers": {
      const known = lk.customers.get(e.record_id);
      const no = cNo(r.customer_no ?? known?.customer_no);
      return { main: no, sub: str(r.full_name) || str(known?.full_name) };
    }
    case "loans": {
      const known = lk.loans.get(e.record_id);
      return { main: str(r.ticket_number) || str(known?.ticket_number), sub: customer(r.customer_id ?? known?.customer_id) };
    }
    case "loan_payments":
      return { main: str(r.receipt_number), sub: ticket(r.loan_id) };
    case "loan_extensions":
    case "reminder_log":
      return { main: ticket(r.loan_id), sub: "" };
    case "cash_flow_entries":
      return { main: ticket(r.related_loan_id), sub: r.related_loan_id ? "" : "Not linked to a loan" };
    case "appraisal_items":
      return { main: aNo(r.appraisal_no ?? lk.appraisals.get(e.record_id)?.appraisal_no), sub: customer(r.customer_id) };
    case "inventory_items":
      return { main: aNo(lk.appraisals.get(str(r.appraisal_item_id))?.appraisal_no), sub: str(r.vault_location) };
    case "inventory_status_history":
    case "physical_inventory_audit_items":
      return { main: appraisalOfItem(r.inventory_item_id), sub: str(r.expected_vault) };
    case "auction_batches":
      return { main: abNo(r.batch_no ?? lk.batches.get(e.record_id)?.batch_no), sub: str(r.auction_place) };
    case "auction_batch_items":
      return { main: abNo(lk.batches.get(str(r.batch_id))?.batch_no), sub: appraisalOfItem(r.inventory_item_id) };
    case "suspicious_activity_flags":
      return { main: customer(r.customer_id), sub: ticket(r.loan_id) };
    case "physical_inventory_audits":
      return { main: str(r.scope_vault) || "All vaults", sub: "" };
    case "profiles":
      return { main: str(r.full_name), sub: r.role ? humanize(str(r.role)) : "" };
    case "system_settings":
      return { main: "Shop settings", sub: "" };
    default:
      return { main: "", sub: "" };
  }
}
