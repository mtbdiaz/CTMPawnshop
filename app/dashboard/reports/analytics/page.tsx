import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatPeso } from "@/lib/format";
import { ReportHeader } from "@/components/report-header";
import { Card, EmptyState, SectionTitle, StatCard } from "@/components/ui";
import { portfolioRates, reportData, type ReportAnalytics } from "@/lib/reports/report-utils";

export const metadata = { title: "Trends & analytics" };

function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-PH", { month: "short", year: "numeric", timeZone: "UTC" });
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// RP8 (Nov 12): Trends & analytics. The four PB-39 metrics stay as chosen in DECISIONS_LOG.md.
// Before: the loans were read in one request, which the database cuts at 1,000 rows, so the rates, the average and
// the monthly volume used only 1,000 of the 1,262 loans; archived loans (removed records) were counted; the
// monthly chart skipped months with no loans; and the page didn't show how many loans each rate counted.
// Now: every loan that isn't archived (RP1), the counts behind each rate, and the last 12 calendar months
// including empty ones.
// RP9 (Nov 12): the database counts the loans per status and per month (report_loan_analytics, migration 0066),
// so no loan rows are sent to the page at all; the rates are worked out from those counts (portfolioRates).
export default async function AnalyticsDashboard() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const r = reportData<ReportAnalytics>(await supabase.rpc("report_loan_analytics"));
  const total = Number(r.total);
  const k = portfolioRates(r.by_status ?? {}, total, Number(r.principal_sum));
  const months = r.months ?? [];
  const maxPrincipal = Math.max(1, ...months.map((m) => Number(m.totalPrincipal)));
  // RP10: the chart's own total, and the loans it can't show (older than 12 months), so it can be checked against all loans
  const yearCount = months.reduce((n, m) => n + Number(m.count), 0);
  const yearPrincipal = months.reduce((n, m) => n + Number(m.totalPrincipal), 0);
  const olderCount = total - yearCount;
  const n = (s: string) => Number(r.by_status?.[s] ?? 0);

  return (
    <div className="space-y-6">
      <ReportHeader
        title="Trends & analytics"
        description="Portfolio health from every loan that isn't archived. The two rates count concluded loans only (redeemed, defaulted or forfeited); running loans are left out of both."
        subtitle={`${total} loans · ${k.concluded} concluded (${k.redeemed} redeemed, ${k.defaulted} defaulted, ${k.forfeited} forfeited) · ${k.running} still running`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* RP10: each hint names the exact count on top and underneath the division */}
        <StatCard label="Redemption rate" value={pct(k.redemptionRate)} tone="success" hint={`Concluded loans only: ${k.redeemed} redeemed ÷ ${k.concluded} concluded`} />
        <StatCard
          label="Forfeiture rate"
          value={pct(k.forfeitureRate)}
          tone={k.forfeitureRate > 0.3 ? "danger" : "default"}
          hint={`Concluded loans only: (${k.defaulted} defaulted + ${k.forfeited} forfeited) ÷ ${k.concluded} concluded`}
        />
        <StatCard label="Average loan size" value={formatPeso(k.averageLoan)} hint={`Mean principal of all ${total} loans`} />
        <StatCard label="Loans issued" value={total.toLocaleString("en-PH")} hint="All time, not archived" />
      </div>
      {/* RP10 (Nov 13): the exact definitions, so nobody reads the two rates as shares of ALL loans.
          Before: one line about Defaulted loans; the reader had to guess why the two rates add up to 100%. */}
      <section className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
        <h2 className="font-semibold text-slate-900">How the two rates are counted (PB-39, decisions log)</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Concluded loans = Redeemed ({k.redeemed}) + Defaulted ({k.defaulted}) + Forfeited ({k.forfeited}) = {k.concluded}.
          </li>
          <li>Redemption rate = Redeemed ÷ Concluded. Forfeiture rate = (Defaulted + Forfeited) ÷ Concluded.</li>
          <li>
            Both rates split the same {k.concluded} concluded loans, so together they are always 100%. They describe how concluded loans ended,
            not the whole portfolio.
          </li>
          <li>
            Not in either rate (still running): Active ({n("active")}), Renewed ({n("extended")}), Reinstated ({n("reinstated")}) = {k.running}.
          </li>
          <li>A Defaulted loan can still be reinstated, so it counts as lost only for now.</li>
        </ul>
      </section>

      <section className="break-inside-avoid">
        <SectionTitle description="Principal lent per month, by loan date, for the last 12 calendar months (months with no loans show ₱0).">Monthly loan volume</SectionTitle>
        <Card>
          {total ? (
            <ul className="space-y-3" aria-label="Monthly loan volume">
              {months.map((m) => (
                <li key={m.month} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 text-sm">
                  <span className="text-slate-600">{monthLabel(m.month)}</span>
                  <span className="h-6 rounded-md bg-slate-100 print:border print:border-slate-300">
                    {Number(m.totalPrincipal) > 0 && (
                      <span
                        // F4: one solid navy colour, no gradient. S5: also prints when "Background graphics" is off
                        className="block h-6 rounded-md bg-navy-700 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
                        style={{ width: `${Math.max(2, (Number(m.totalPrincipal) / maxPrincipal) * 100)}%` }}
                      />
                    )}
                  </span>
                  <span className="whitespace-nowrap text-right tabular-nums">
                    <span className="font-semibold text-navy-900">{formatPeso(Number(m.totalPrincipal))}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {m.count} loan{m.count === 1 ? "" : "s"}
                    </span>
                  </span>
                </li>
              ))}
              {/* RP10: the 12 months added up, and what the chart leaves out */}
              <li className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 border-t border-slate-200 pt-3 text-sm font-semibold text-navy-900">
                <span>12 months</span>
                <span className="text-xs font-normal text-slate-600">
                  {olderCount > 0 ? `${olderCount} older loan${olderCount === 1 ? " is" : "s are"} not in the chart` : `All ${total} loans are in these 12 months`}
                </span>
                <span className="whitespace-nowrap text-right tabular-nums">
                  {formatPeso(yearPrincipal)}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {yearCount} loan{yearCount === 1 ? "" : "s"}
                  </span>
                </span>
              </li>
            </ul>
          ) : (
            <EmptyState icon="chart" title="No loan data yet" />
          )}
        </Card>
      </section>
    </div>
  );
}
