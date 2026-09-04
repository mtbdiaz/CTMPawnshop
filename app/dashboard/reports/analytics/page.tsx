import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/print-button";
import {
  computeRedemptionRate,
  computeForfeitureRate,
  computeAverageLoanSize,
  computeMonthlyVolume,
} from "@/lib/reports/analytics";

export default async function AnalyticsDashboard() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const { data: loans } = await supabase.from("loans").select("principal_amount, status, loan_date");
  const rows = loans ?? [];

  const redemptionRate = computeRedemptionRate(rows);
  const forfeitureRate = computeForfeitureRate(rows);
  const avgLoanSize = computeAverageLoanSize(rows);
  const monthly = computeMonthlyVolume(rows);
  const maxCount = Math.max(1, ...monthly.map((m) => m.count));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Trends &amp; Analytics Dashboard</h1>
        <PrintButton />
      </div>
      <p className="mt-1 text-sm text-slate-500 print:hidden">
        Concrete metrics chosen for this dashboard (PB-39 was flagged not Testable as originally
        written): redemption rate, forfeiture rate, average loan size, and monthly loan volume.
        See DECISIONS_LOG.md.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-4 max-w-2xl">
        <MetricCard label="Redemption rate" value={`${(redemptionRate * 100).toFixed(1)}%`} />
        <MetricCard label="Forfeiture rate" value={`${(forfeitureRate * 100).toFixed(1)}%`} />
        <MetricCard label="Average loan size" value={`₱${avgLoanSize.toLocaleString()}`} />
      </div>

      <h2 className="mt-8 text-sm font-medium text-slate-900">Monthly loan volume</h2>
      <div className="mt-2 max-w-2xl space-y-2">
        {monthly.length ? (
          monthly.map((m) => (
            <div key={m.month} className="flex items-center gap-2 text-sm">
              <span className="w-20 text-slate-500">{m.month}</span>
              <div className="h-4 flex-1 rounded bg-slate-100">
                <div
                  className="h-4 rounded bg-slate-700"
                  style={{ width: `${(m.count / maxCount) * 100}%` }}
                />
              </div>
              <span className="w-32 text-right text-slate-600">
                {m.count} loans / ₱{m.totalPrincipal.toLocaleString()}
              </span>
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-500">No loan data yet.</p>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}
