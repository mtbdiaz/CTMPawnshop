import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export default async function AuditTrailPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string }>;
}) {
  await requireRole(["admin"]);
  const { table } = await searchParams;

  const supabase = await createClient();
  let query = supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(200);
  if (table) query = query.eq("table_name", table);
  const { data: entries } = await query;

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Audit Trail &amp; System Log</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every create/update/delete across the system, logged automatically. Read-only — not even
        an Admin can edit or delete these rows.
      </p>

      <form className="mt-4" action="/dashboard/compliance/audit">
        <input
          type="text"
          name="table"
          defaultValue={table ?? ""}
          placeholder="Filter by table name (e.g. loans)"
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </form>

      <table className="mt-4 w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500">
            <th className="pb-2 pr-4">When</th>
            <th className="pb-2 pr-4">Table</th>
            <th className="pb-2 pr-4">Action</th>
            <th className="pb-2 pr-4">Record</th>
            <th className="pb-2 pr-4">Actor</th>
          </tr>
        </thead>
        <tbody>
          {entries?.length ? (
            entries.map((e) => (
              <tr key={e.id} className="border-t border-slate-200">
                <td className="py-2 pr-4">{new Date(e.created_at).toLocaleString()}</td>
                <td className="py-2 pr-4">{e.table_name}</td>
                <td className="py-2 pr-4">{e.action}</td>
                <td className="py-2 pr-4 font-mono text-xs">{e.record_id}</td>
                <td className="py-2 pr-4 font-mono text-xs">{e.actor ?? "system/service"}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="py-4 text-sm text-slate-500">
                No audit entries yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
