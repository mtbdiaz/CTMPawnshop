import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, humanize } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader, Pagination, Table, TBody, TD, TH, THead, TR, buttonClasses, pageParam } from "@/components/ui";

export const metadata = { title: "Audit trail" };

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
  "auction_batches",
  "auction_batch_items",
  "suspicious_activity_flags",
  "reminder_log",
  "profiles",
  "system_settings",
];
const ACTIONS = ["INSERT", "UPDATE", "DELETE"] as const;
const ACTION_LABEL: Record<string, string> = { INSERT: "Created", UPDATE: "Updated", DELETE: "Deleted" };

export default async function AuditTrailPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; action?: string; page?: string }>;
}) {
  await requireRole(["admin"]);
  const params = await searchParams;
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
      <PageHeader
        title="Audit trail"
        description="Every create, update and delete across the system, recorded automatically. Read-only — nobody, including Admins, can edit or delete these entries."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Audit trail" }]}
      />

      <Card padded={false}>
        <form action="/dashboard/compliance/audit" className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
          <div>
            <label htmlFor="table" className="block text-xs font-medium text-slate-600">
              Record type
            </label>
            <select id="table" name="table" defaultValue={table ?? ""} className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm">
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
            <select id="action" name="action" defaultValue={action ?? ""} className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm">
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
                    <TD className="whitespace-nowrap text-slate-600">{formatDateTime(e.created_at)}</TD>
                    <TD>
                      {humanize(e.table_name)}
                      <span className="block font-mono text-[11px] text-slate-400">{e.record_id}</span>
                    </TD>
                    <TD>
                      <Badge tone={e.action === "DELETE" ? "danger" : e.action === "INSERT" ? "success" : "info"}>
                        {ACTION_LABEL[e.action] ?? e.action}
                      </Badge>
                    </TD>
                    <TD>{e.actor ? (names.get(e.actor) ?? "Unknown user") : <span className="text-slate-500">System / service</span>}</TD>
                    <TD>
                      {e.changed_data ? (
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-navy-700 hover:underline">View data</summary>
                          <pre className="mt-2 max-h-64 max-w-md overflow-auto rounded-md bg-slate-900 p-3 text-[11px] text-slate-100">
                            {JSON.stringify(e.changed_data, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        "—"
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/dashboard/compliance/audit" params={{ table, action }} />
          </>
        ) : (
          <EmptyState icon="log" title="No audit entries match these filters" />
        )}
      </Card>
    </div>
  );
}
