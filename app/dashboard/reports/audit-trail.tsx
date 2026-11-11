import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, humanize } from "@/lib/format";
import { Badge, Card, EmptyState, Pagination, Table, TBody, TD, TH, THead, TR, buttonClasses, pageParam } from "@/components/ui";
import { allFields, changedFields } from "@/lib/audit/changes"; // C10: works out which columns changed (old -> new); AT2: every field for the popup
import { AuditDataButton } from "./audit-data-dialog"; // AT2: View data opens a popup instead of opening inside the row


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

export async function AuditTrail({ params }: { params: { table?: string; action?: string; page?: string } }) {
  await requireRole(["admin"]);
  const table = TABLES.includes(params.table ?? "") ? params.table : undefined;
  const action = ACTIONS.find((a) => a === params.action);
  const page = pageParam(params.page);

  const supabase = await createClient();
  let query = supabase
    .from("audit_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (table) query = query.eq("table_name", table);
  if (action) query = query.eq("action", action);

  const [{ data: entries, count, error }, { data: staff }] = await Promise.all([
    query,
    supabase.from("profiles").select("id, full_name"),
  ]);
  if (error) throw error;
  const names = new Map((staff ?? []).map((p) => [p.id, p.full_name]));

  return (
    <div>
      <p className="mb-3 text-sm text-slate-600">
        Every create, update and delete, recorded automatically. Admin corrections show the reason and before/after values.
        Nobody, including Admins, can edit or remove these entries.
      </p>

      <Card padded={false}>
        <form action="/dashboard/reports" className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
          <input type="hidden" name="tab" value="audit" />
          <div>
            <label htmlFor="table" className="block text-xs font-medium text-slate-600">
              Record type
            </label>
            {/* F4: rounded-md (6px corners) */}
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
            {/* F4: rounded-md (6px corners) */}
            <select id="action" name="action" defaultValue={action ?? ""} className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm">             
               <option value="">Any</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonClasses("secondary")}>
            Apply filters
          </button>
        </form>
        {entries && entries.length > 0 ? (
          <>
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
                            <ul className="mb-1 max-w-md space-y-0.5 text-xs text-slate-700">
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
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/dashboard/reports" params={{ tab: "audit", table, action }} />
          </>
        ) : (
          <EmptyState icon="log" title="No audit entries match these filters" />
        )}
      </Card>
    </div>
  );
}
