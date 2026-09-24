import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatPeso } from "@/lib/format";
import { ReportHeader } from "@/components/report-header";
import { Card, EmptyState, SectionTitle, StatCard } from "@/components/ui";
import {
  computeRedemptionRate,
  computeForfeitureRate,
  computeAverageLoanSize,
  computeMonthlyVolume,
} from "@/lib/reports/analytics";

export const metadata = { title: "Trends & analytics" };

function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-PH", { month: "short", year: "numeric", timeZone: "UTC" });
}

export default async function AnalyticsDashboard() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const { data: loans, error } = await supabase.from("loans").select("principal_amount, status, loan_date");
  if (error) throw error;
  const rows = loans ?? [];

  const concluded = rows.filter((l) => ["redeemed", "defaulted", "forfeited"].includes(l.status)).length;
  const redemptionRate = computeRedemptionRate(rows);
  const forfeitureRate = computeForfeitureRate(rows);
  const avgLoanSize = computeAverageLoanSize(rows);
  const monthly = computeMonthlyVolume(rows).slice(-12);
  const maxPrincipal = Math.max(1, ...monthly.map((m) => m.totalPrincipal));

  return (
    <div className="space-y-6">
      <ReportHeader
        title="Trends & analytics"
        description="Portfolio health at a glance. Rates are based on concluded loans (redeemed, defaulted or forfeited)."
        subtitle={`${rows.length} loans all-time · ${concluded} concluded`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Redemption rate" value={`${(redemptionRate * 100).toFixed(1)}%`} tone="success" hint="Concluded loans that were redeemed" />
        <StatCard label="Forfeiture rate" value={`${(forfeitureRate * 100).toFixed(1)}%`} tone={forfeitureRate > 0.3 ? "danger" : "default"} hint="Concluded loans lost to default" />
        <StatCard label="Average loan size" value={formatPeso(avgLoanSize)} hint="Mean principal, all loans" />
        <StatCard label="Loans issued" value={rows.length} hint="All-time" />
      </div>

      <section className="break-inside-avoid">
        <SectionTitle description="Principal disbursed per month (last 12 months with activity).">Monthly loan volume</SectionTitle>
        <Card>
          {monthly.length ? (
            <ul className="space-y-3" aria-label="Monthly loan volume">
              {monthly.map((m) => (
                <li key={m.month} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 text-sm">
                  <span className="text-slate-600">{monthLabel(m.month)}</span>
                  <span className="h-6 rounded-md bg-slate-100 print:border print:border-slate-300">
                    <span
                      className="block h-6 rounded-md bg-gradient-to-r from-navy-700 to-navy-500 print:bg-navy-700"
                      style={{ width: `${Math.max(2, (m.totalPrincipal / maxPrincipal) * 100)}%` }}
                    />
                  </span>
                  <span className="whitespace-nowrap text-right tabular-nums">
                    <span className="font-semibold text-navy-900">{formatPeso(m.totalPrincipal)}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {m.count} loan{m.count === 1 ? "" : "s"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="chart" title="No loan data yet" />
          )}
        </Card>
      </section>
    </div>
  );
}
