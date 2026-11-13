import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { formatDate, formatDateTime, humanize, manilaToday } from "@/lib/format";
import { dateParam, reportData } from "@/lib/reports/report-utils";
import type { Json } from "@/lib/supabase/database.types";
import { Badge, Card, EmptyState, Pagination, Table, TBody, TD, TH, THead, TR, buttonClasses, pageParam } from "@/components/ui";
import { affectedLabel, allFields, changedFields, maskSensitive } from "@/lib/audit/changes"; // C10: which columns changed; AT2: every field for the popup; AT3: masking + affected record
import { AuditDataButton } from "./audit-data-dialog"; // AT2: View data opens a popup instead of opening inside the row
import { PrintScope } from "./report-parts"; // RP11: says on paper when only part of the list is printed


const PAGE_SIZE = 50;
const TABLES = [
  "customers",
  "appraisal_items",
  "loans",
  "loan_payments",
  "loan_extensions",
  "inventory_items",
  "inventory_status_history",
  "cash_flow_entries",
  "physical_inventory_audits",
  "physical_inventory_audit_items",
  "physical_inventory_audit_followups", // AD1: the checks done after an audit (migration 0046)
  "auction_batches",
  "auction_batch_items",
  "suspicious_activity_flags",
  "reminder_log",
  "profiles",
  "system_settings",
];
const ACTIONS = ["INSERT", "UPDATE", "DELETE"] as const;
const ACTION_LABEL: Record<string, string> = { INSERT: "Created", UPDATE: "Updated", DELETE: "Deleted" };
const SHOW_CHANGES = 5; // C10: how many changed columns are listed before "+N more"

// one entry as audit_log_page sends it (ID numbers already masked by the database)
type AuditEntry = { id: string; table_name: string; record_id: string; action: string; actor: string | null; created_at: string; changed_data: Json | null; old_data: Json | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// AT3 (Nov 12): what the "Find record" box understands: a record ID, a pawn ticket (PT-...), a receipt (RC-...),
// a customer number (C-0012) or an appraisal number (A-0036). Anything else is ignored (and the page says so).
function recordSearch(q: string): { kind: "id" | "ticket" | "receipt" | "customer" | "appraisal"; value: string } | null {
  const s = q.trim();
  if (!s) return null;
  if (UUID_RE.test(s)) return { kind: "id", value: s.toLowerCase() };
  if (/^PT-/i.test(s)) return { kind: "ticket", value: s.toUpperCase() };
  if (/^RC-/i.test(s)) return { kind: "receipt", value: s.toUpperCase() };
  const c = /^c[\s-]?(\d{1,9})$/i.exec(s);
  if (c) return { kind: "customer", value: String(Number(c[1])) };
  const a = /^a[\s-]?(\d{1,9})$/i.exec(s);
  if (a) return { kind: "appraisal", value: String(Number(a[1])) };
  return null;
}

export async function AuditTrail({ params }: { params: Record<string, string | undefined> }) {
  await requireRole(["admin"]);
  const table = TABLES.includes(params.table ?? "") ? params.table : undefined;
  const action = ACTIONS.find((a) => a === params.action);
  const page = pageParam(params.page);
  const today = manilaToday();
  const from = dateParam(params.from);
  const to = dateParam(params.to);
  const badRange = Boolean(from && to && from > to);
  const q = (params.q ?? "").trim().slice(0, 80);
  const find = recordSearch(q);

  const supabase = await createClient();
  const { data: staff } = await supabase.from("profiles").select("id, full_name").order("full_name");
  const names = new Map((staff ?? []).map((p) => [p.id, p.full_name]));
  // AT3: "By" filter: one employee, or "System / service" (no signed-in person, e.g. a database job)
  const by = params.by === "system" || names.has(params.by ?? "") ? params.by : undefined;

  // AT4 (Nov 12): the audit log is read only through the database function audit_log_page (migration 0066).
  // Before: this page read the audit_log table directly and masked ID numbers here in TypeScript, so the full
  // numbers still left the database (an Admin could read them straight from the table with their own login).
  // Now: direct reads of audit_log are refused for every login; audit_log_page checks that the caller is an
  // Admin, filters and pages in the database, and masks ID numbers there (only the last 4 digits leave the
  // database). The stored entries are never changed. maskSensitive below stays as a second safety layer.
  const { data, error } = await supabase.rpc("audit_log_page", {
    p_table: table,
    p_action: action,
    p_by: by,
    // AT3: Manila calendar days, the same boundaries as the other reports
    p_from: badRange ? undefined : from,
    p_to: badRange ? undefined : to,
    p_find_kind: find?.kind,
    p_find: find?.value,
    p_page: page,
    p_size: PAGE_SIZE,
  });
  const result = reportData<{ total: number; page: number; rows: AuditEntry[] }>({ data, error });
  const count = Number(result.total);
  const entries = (result.rows ?? []).map((e) => ({ ...e, changed_data: maskSensitive(e.changed_data), old_data: maskSensitive(e.old_data) }));
  const filtered = Boolean(table || action || by || from || to || q);
  const listParams = { tab: "audit", table, action, by, from: badRange ? undefined : from, to: badRange ? undefined : to, q: q || undefined };

  return (
    <div>
      <p className="mb-3 text-sm text-slate-600">
        Every create, update and delete, recorded automatically. Admin corrections show the reason and before/after values.
        Nobody, including Admins, can edit or remove these entries. ID numbers show only their last 4 digits.
      </p>

      <Card padded={false}>
        {/* AT3: record type, action, who, a date range and a record to find; all sent in the address, so Back keeps them */}
        <form action="/dashboard/reports" className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
          <input type="hidden" name="tab" value="audit" />
          <div>
            <label htmlFor="table" className="block text-xs font-medium text-slate-600">
              Record type
            </label>
            <select id="table" name="table" defaultValue={table ?? ""} className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option value="">All records</option>
              {TABLES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="action" className="block text-xs font-medium text-slate-600">
              Action
            </label>
            <select id="action" name="action" defaultValue={action ?? ""} className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option value="">Any</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="by" className="block text-xs font-medium text-slate-600">
              By
            </label>
            <select id="by" name="by" defaultValue={by ?? ""} className="mt-1 max-w-[12rem] rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option value="">Anyone</option>
              <option value="system">System / service</option>
              {(staff ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="from" className="block text-xs font-medium text-slate-600">
              From
            </label>
            <input id="from" name="from" type="date" defaultValue={from ?? ""} max={today} className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="to" className="block text-xs font-medium text-slate-600">
              To
            </label>
            <input id="to" name="to" type="date" defaultValue={to ?? ""} max={today} className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor="q" className="block text-xs font-medium text-slate-600">
              Find record
            </label>
            <input id="q" name="q" type="search" defaultValue={q} placeholder="PT-…, RC-…, C-0012, A-0036 or ID" className="mt-1 w-56 rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <button type="submit" className={buttonClasses("secondary")}>
            Apply filters
          </button>
          {filtered && (
            <Link href="/dashboard/reports?tab=audit" className="py-2 text-sm font-medium text-navy-700 hover:underline">
              Reset filters
            </Link>
          )}
        </form>
        {(badRange || (q && !find)) && (
          <p className="border-b border-slate-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="status">
            {badRange && "The From date is after the To date, so the dates were not used. "}
            {q && !find && "Find record understands a pawn ticket (PT-…), a receipt (RC-…), a customer number (C-0012), an appraisal number (A-0036) or a record ID, so it was not used."}
          </p>
        )}
        <p className="border-b border-slate-200 px-4 py-2 text-sm text-slate-600" aria-live="polite">
          {(count ?? 0).toLocaleString("en-PH")} entr{count === 1 ? "y" : "ies"}
          {from || to ? ` · ${from ? formatDate(from) : "start"} – ${to ? formatDate(to) : "today"}` : ""}
        </p>
        {entries && entries.length > 0 ? (
          <>
            <PrintScope page={page} size={PAGE_SIZE} total={count} shown={entries.length} all={false} totalRow={false} advice="Narrow the filters (dates, record type, Find record) or print each page." />
            <Table minWidth="760px">
              <THead>
                <TH>When</TH>
                <TH>Record</TH>
                <TH>Action</TH>
                <TH>By</TH>
                <TH>Details</TH>
              </THead>
              <TBody>
                {entries.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap align-top text-slate-600">{formatDateTime(e.created_at)}</TD>
                    {/* AT2: align-top on every cell, so a long Details cell never pushes the other columns down */}
                    <TD className="align-top">
                      {humanize(e.table_name)}
                      {/* AT3: which customer, loan, item or entry, from the saved row (e.g. "Juan Dela Cruz · C-0012") */}
                      {affectedLabel(e.table_name, e.changed_data ?? e.old_data) && (
                        <span className="block max-w-[16rem] truncate text-xs text-slate-700" title={affectedLabel(e.table_name, e.changed_data ?? e.old_data)}>
                          {affectedLabel(e.table_name, e.changed_data ?? e.old_data)}
                        </span>
                      )}
                      {/* F3: slate-500 so the record ID is readable */}
                      <span className="block font-mono text-[11px] text-slate-500">{e.record_id}</span>
                    </TD>
                    <TD className="align-top">
                      <Badge tone={e.action === "DELETE" ? "danger" : e.action === "INSERT" ? "success" : "info"}>
                        {ACTION_LABEL[e.action] ?? e.action}
                      </Badge>
                    </TD>
                    <TD className="align-top">{e.actor ? (names.get(e.actor) ?? "Unknown user") : <span className="text-slate-500">System / service</span>}</TD>
                    <TD className="align-top">
                      {(e.changed_data as { admin_edit?: boolean; reason?: string } | null)?.admin_edit && (
                        <p className="mb-1 text-xs font-medium text-amber-900">
                          Admin edit. Reason: {(e.changed_data as { reason?: string }).reason}
                        </p>
                      )}
                      {/* C10: for an update, list what changed ("Status: Defaulted → Active"). Since Matt's #12 (Nov 6, 2026)
                          the row before the change is saved too (old_data); older entries only have the new row */}
                      {e.action === "UPDATE" &&
                        (() => {
                          const changes = changedFields(e.old_data, e.changed_data, names); // null = no old row to compare with
                          if (changes === null)
                            return <p className="mb-1 text-xs text-slate-500">Older entry: only the new values were saved, so the change can&apos;t be shown.</p>;
                          if (changes.length === 0) return <p className="mb-1 text-xs text-slate-500">No visible change (only the update time).</p>;
                          return (
                            // AT6 (Nov 13): "relative" keeps the hidden "changed to" labels (sr-only = position: absolute) inside the
                            // table's scroll box. Before: nothing around them was positioned, so they escaped it and made the whole
                            // page scroll sideways on a phone (759 px wide on a 360 px screen) and on a tablet (14 px).
                            <ul className="relative mb-1 max-w-md space-y-0.5 text-xs text-slate-700">
                              {changes.slice(0, SHOW_CHANGES).map((c) => (
                                <li key={c.key}>
                                  {/* the column name, then old -> new. The arrow is read out as "changed to" by screen readers */}
                                  <span className="font-medium text-slate-900">{c.label}:</span> {c.before}{" "}
                                  <span aria-hidden="true">→</span>
                                  <span className="sr-only">changed to</span> <span className="font-medium text-slate-900">{c.after}</span>
                                </li>
                              ))}
                              {/* more than 5 changed: the rest are in View data */}
                              {changes.length > SHOW_CHANGES && <li className="text-slate-500">+{changes.length - SHOW_CHANGES} more in View data</li>}
                            </ul>
                          );
                        })()}
                      {e.changed_data ? (
                        // AT2: a popup with one line per field (Before / After), changed ones marked and first
                        <AuditDataButton
                          title={`${humanize(e.table_name)} · ${ACTION_LABEL[e.action] ?? e.action}`}
                          subtitle={`${formatDateTime(e.created_at)} · ${e.actor ? (names.get(e.actor) ?? "Unknown user") : "System / service"} · ID …${String(e.record_id).slice(-6)}`}
                          reason={(e.changed_data as { admin_edit?: boolean; reason?: string } | null)?.admin_edit ? (e.changed_data as { reason?: string }).reason : undefined}
                          rows={allFields(e.action === "UPDATE" ? e.old_data : null, e.changed_data, names)}
                          raw={{ before: e.action === "UPDATE" ? (e.old_data ?? null) : null, after: e.changed_data }}
                        />
                      ) : (
                        ""
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/dashboard/reports" params={listParams} />
          </>
        ) : (
          <EmptyState icon="log" title={filtered ? "No audit entries match these filters" : "No audit entries yet"} />
        )}
      </Card>
    </div>
  );
}
