// Archive Phase 2B (Nov 15): the Archive list, worked out from the rows the page reads. Pure helpers (no Supabase), so
// they can be unit-tested: readable names for each record type, search and filters, sorting and the 10-per-page cut.
// Whether a record can be restored is never decided here: the database answers that (archive_restore_check, 0085).

import { ARCHIVE_POLICY, type ArchivableTable } from "@/lib/archive";
import { formatDate } from "@/lib/format";

export const ARCHIVE_PAGE_SIZE = 10;
export const ARCHIVE_LIST_LIMIT = 500; // the newest 500 archived records of a type are read; the page says so if it's cut

export type ArchiveRow = {
  id: string;
  title: string; // e.g. "Customer #379 · Arch Coles"
  detail: string; // e.g. "09295378191"
  reason: string; // why it was archived ("" when none was written)
  archivedAt: string;
  archivedById: string | null; // null = archived by a one-time data cleanup, not a person
  archivedBy: string; // the staff member's name, or "System (data cleanup)"
  href: string | null; // the record's own page, when it has one
};

export type ArchiveWhen = "any" | "30d" | "year";
export type ArchiveSort = "newest" | "oldest";
export type ArchiveFilters = { q: string; when: ArchiveWhen; by: string; sort: ArchiveSort };
export const SYSTEM_ACTOR = "system";

/** Reads ?q= ?when= ?by= ?sort= safely (anything unknown = no filter). */
export function archiveFilters(p: { q?: string; when?: string; by?: string; sort?: string }): ArchiveFilters {
  const when: ArchiveWhen = p.when === "30d" || p.when === "year" ? p.when : "any";
  const sort: ArchiveSort = p.sort === "oldest" ? "oldest" : "newest";
  const by = p.by === SYSTEM_ACTOR || /^[0-9a-f-]{36}$/i.test(p.by ?? "") ? (p.by as string) : "";
  return { q: (p.q ?? "").trim().slice(0, 80), when, by, sort };
}

export function isFiltered(f: ArchiveFilters) {
  return f.q !== "" || f.when !== "any" || f.by !== "" || f.sort !== "newest";
}

/** "auction batches" -> "auction batch", "cash entries" -> "cash entry", "customers" -> "customer". */
function singular(plural: string) {
  return plural.replace(/ies$/, "y").replace(/ches$/, "ch").replace(/s$/, "");
}

/**
 * The line above the list, e.g. "8 archived customers." or "1 of 15 archived vault audits matches.".
 * Empty when the type has nothing archived: the empty box under it already says so (no need to say it twice).
 * Changing only the sort isn't a filter, so it keeps the plain count.
 */
export function archiveCountLine(label: string, total: number, shown: number, f: ArchiveFilters, limit = ARCHIVE_LIST_LIMIT): string {
  if (total === 0) return "";
  const name = label.toLowerCase();
  const narrowed = f.q !== "" || f.when !== "any" || f.by !== "";
  if (narrowed) {
    if (shown === 0) return "No archived records match these filters.";
    return `${shown} of ${total} archived ${total === 1 ? singular(name) : name} ${shown === 1 ? "matches" : "match"}.`;
  }
  return `${total} archived ${total === 1 ? singular(name) : name}${total >= limit ? ` (the newest ${limit})` : ""}.`;
}

/** Search (every word must appear in the name, details, reason or who archived it), date, person, then sort. */
export function filterArchiveRows(rows: ArchiveRow[], f: ArchiveFilters, now: Date = new Date()): ArchiveRow[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const since =
    f.when === "30d" ? now.getTime() - 30 * 86_400_000 : f.when === "year" ? new Date(now.getFullYear(), 0, 1).getTime() : null;
  return rows
    .filter((r) => (since === null ? true : new Date(r.archivedAt).getTime() >= since))
    .filter((r) => (f.by === "" ? true : f.by === SYSTEM_ACTOR ? r.archivedById === null : r.archivedById === f.by))
    .filter((r) => {
      if (!words.length) return true;
      const text = `${r.title} ${r.detail} ${r.reason} ${r.archivedBy}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => (f.sort === "oldest" ? 1 : -1) * (new Date(a.archivedAt).getTime() - new Date(b.archivedAt).getTime()));
}

export function pageOf<T>(rows: T[], page: number, size = ARCHIVE_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { page: p, pages, rows: rows.slice((p - 1) * size, p * size) };
}

const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const words = (v: unknown) => String(v ?? "").replace(/_/g, " ");
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const item = (a: { karat?: unknown; category?: unknown; weight_grams?: unknown } | null) =>
  a ? `${a.karat}K ${words(a.category)}, ${Number(a.weight_grams ?? 0)} g` : "item";

/** A readable name for one archived record (never a database ID or a raw timestamp). */
export function describeArchived(table: ArchivableTable, r: Record<string, unknown>): Pick<ArchiveRow, "title" | "detail" | "href"> {
  switch (table) {
    case "customers":
      return { title: `Customer #${r.customer_no} · ${r.full_name}`, detail: String(r.contact_number ?? ""), href: `/dashboard/customers/${r.id}` };
    case "appraisal_items": {
      const c = one(r.customers as { full_name: string } | null);
      return { title: `Appraisal #${r.appraisal_no} · ${item(r as never)}`, detail: c ? `Customer: ${c.full_name}` : "No customer on it", href: `/dashboard/appraisals/${r.id}` };
    }
    case "loans": {
      const c = one(r.customers as { full_name: string } | null);
      return { title: `Loan ${r.ticket_number}`, detail: [words(r.status), peso(r.principal_amount), c?.full_name].filter(Boolean).join(" · "), href: `/dashboard/loans/${r.id}` };
    }
    case "loan_payments": {
      const l = one(r.loans as { ticket_number: string } | null);
      return { title: `Payment ${r.receipt_number ?? ""}`.trim(), detail: [peso(r.amount), l ? `Loan ${l.ticket_number}` : null].filter(Boolean).join(" · "), href: null };
    }
    case "loan_extensions": {
      const l = one(r.loans as { ticket_number: string } | null);
      return { title: `Renewal${l ? ` of ${l.ticket_number}` : ""}`, detail: [words(r.extension_type), r.new_maturity_date ? `new due date ${formatDate(String(r.new_maturity_date))}` : null].filter(Boolean).join(" · "), href: null };
    }
    case "inventory_items": {
      const a = one(r.appraisal_items as { appraisal_no?: number; karat?: number; category?: string; weight_grams?: number } | null);
      const l = one(r.loans as { ticket_number: string } | null);
      return { title: `Item · ${item(a)}`, detail: [words(r.status), l ? `Loan ${l.ticket_number}` : null, a?.appraisal_no ? `Appraisal #${a.appraisal_no}` : null].filter(Boolean).join(" · "), href: null };
    }
    case "cash_flow_entries":
      return { title: `${words(r.entry_type).replace(/^\w/, (c) => c.toUpperCase())} · ${peso(r.amount)}`, detail: String(r.description ?? ""), href: null };
    case "auction_batches": {
      const n = Number(one(r.auction_batch_items as { count: number } | null)?.count ?? 0);
      return { title: `Auction batch #${r.batch_no}`, detail: [`${n} item${n === 1 ? "" : "s"}`, r.auction_date ? `auction ${formatDate(String(r.auction_date))}` : null].filter(Boolean).join(" · "), href: null };
    }
    case "physical_inventory_audits":
      return { title: `Vault audit · ${r.scope_vault ?? "All vaults"}`, detail: [words(r.status), r.started_at ? `started ${formatDate(String(r.started_at))}` : null].filter(Boolean).join(" · "), href: null };
    case "suspicious_activity_flags": {
      const c = one(r.customers as { full_name: string } | null);
      return { title: `Flag · ${c?.full_name ?? "customer"}`, detail: [words(r.status), String(r.reason ?? "")].filter(Boolean).join(" · "), href: null };
    }
    case "reminder_log": {
      const l = one(r.loans as { ticket_number: string } | null);
      return { title: `Reminder${l ? ` · Loan ${l.ticket_number}` : ""}`, detail: [words(r.contact_method), words(r.outcome), r.sent_at ? formatDate(String(r.sent_at)) : null].filter(Boolean).join(" · "), href: null };
    }
  }
}

/** The columns each type needs for its readable name (no ID numbers: staff can't read those). */
export const ARCHIVE_SELECT: Record<ArchivableTable, string> = {
  customers: "customer_no, full_name, contact_number",
  appraisal_items: "appraisal_no, category, karat, weight_grams, customers(full_name)",
  loans: "ticket_number, status, principal_amount, customers(full_name)",
  loan_payments: "receipt_number, amount, loans(ticket_number)",
  loan_extensions: "new_maturity_date, extension_type, loans(ticket_number)",
  inventory_items: "status, appraisal_items(appraisal_no, category, karat, weight_grams), loans(ticket_number)",
  cash_flow_entries: "entry_type, amount, description",
  auction_batches: "batch_no, auction_date, auction_batch_items(count)",
  physical_inventory_audits: "scope_vault, status, started_at",
  suspicious_activity_flags: "reason, status, customers!suspicious_activity_flags_customer_id_fkey(full_name)",
  reminder_log: "contact_method, outcome, sent_at, loans(ticket_number)",
};

/** Why a whole type is history only (shown instead of a Restore button; Wush's decisions 2 and 3, ledger lock). */
export function historyOnlyReason(table: ArchivableTable): string | null {
  if (ARCHIVE_POLICY[table].restore !== "never") return null;
  switch (table) {
    case "loan_payments":
    case "loan_extensions":
    case "reminder_log":
      return "Payments, renewals and reminders are permanent history. They stay as they are and can't be restored.";
    case "cash_flow_entries":
      return "Ledger entries can't be archived or restored while the ledger is locked. Corrections will need the approved reversal process.";
    case "auction_batches":
      return "Archived auction batches stay archived: their items have moved on since, so the batch is kept as read-only history.";
    case "physical_inventory_audits":
      return "Archived vault audits stay in history as they are. They can't be put back into active audits.";
    default:
      return "Records of this type can't be restored.";
  }
}
