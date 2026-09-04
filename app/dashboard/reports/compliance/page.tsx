import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/print-button";

export default async function ComplianceReport() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const [{ data: flaggedCustomers }, { data: blacklisted }, { data: flags }] = await Promise.all([
    supabase.from("customers").select("full_name, aml_status, aml_checked_at, aml_notes").eq("aml_status", "flagged"),
    supabase.from("customers").select("full_name, blacklist_reason").eq("is_blacklisted", true),
    supabase.from("suspicious_activity_flags").select("*, customers(full_name)").order("created_at", { ascending: false }),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Compliance / AML Report</h1>
        <PrintButton />
      </div>
      <p className="mt-1 text-sm text-slate-500 print:hidden">
        AML checks, blacklist actions, and suspicious activity flags — compiled for regulator/
        auditor review. Generated {new Date().toLocaleString()}.
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-slate-900">Customers flagged by AML check</h2>
        <ul className="mt-2 text-sm text-slate-700">
          {flaggedCustomers?.length ? (
            flaggedCustomers.map((c) => (
              <li key={c.full_name} className="border-t border-slate-200 py-1">
                {c.full_name} — {c.aml_notes} ({c.aml_checked_at ? new Date(c.aml_checked_at).toLocaleDateString() : "—"})
              </li>
            ))
          ) : (
            <li className="text-slate-500">None.</li>
          )}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-slate-900">Blacklisted customers</h2>
        <ul className="mt-2 text-sm text-slate-700">
          {blacklisted?.length ? (
            blacklisted.map((c) => (
              <li key={c.full_name} className="border-t border-slate-200 py-1">
                {c.full_name} — {c.blacklist_reason}
              </li>
            ))
          ) : (
            <li className="text-slate-500">None.</li>
          )}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-slate-900">Suspicious activity flags</h2>
        <ul className="mt-2 text-sm text-slate-700">
          {flags?.length ? (
            flags.map((f) => (
              <li key={f.id} className="border-t border-slate-200 py-1">
                {(f as unknown as { customers: { full_name: string } | null }).customers?.full_name ?? "—"} —{" "}
                {f.reason} — <span className="capitalize">{f.status}</span>
              </li>
            ))
          ) : (
            <li className="text-slate-500">None.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
