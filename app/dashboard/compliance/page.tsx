import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { FlagRow } from "./flag-row";

export default async function CompliancePage() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const { data: flags } = await supabase
    .from("suspicious_activity_flags")
    .select("*, customers(full_name)")
    .eq("status", "open")
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Suspicious Activity Review</h1>
          <p className="mt-1 text-sm text-slate-500">
            Open flags from automatic AML pattern checks (placeholder rules — see DECISIONS_LOG.md).
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/compliance/reminders" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
            Due-date reminders
          </Link>
          <Link href="/dashboard/compliance/audit" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
            Audit trail
          </Link>
        </div>
      </div>

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500">
            <th className="pb-2 pr-4">Customer</th>
            <th className="pb-2 pr-4">Reason</th>
            <th className="pb-2 pr-4">Action</th>
          </tr>
        </thead>
        <tbody>
          {flags?.length ? (
            flags.map((flag) => (
              <FlagRow
                key={flag.id}
                flagId={flag.id}
                reason={flag.reason}
                customerName={(flag as unknown as { customers: { full_name: string } | null }).customers?.full_name ?? "—"}
              />
            ))
          ) : (
            <tr>
              <td colSpan={3} className="py-4 text-sm text-slate-500">
                No open flags.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
