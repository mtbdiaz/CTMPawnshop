import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPeso, manilaToday } from "@/lib/format";
import { ReportHeader } from "@/components/report-header";
import { Alert, Card, EmptyState, SectionTitle, Table, TBody, TD, TH, THead, TR, buttonClasses, cx } from "@/components/ui";
import {
  addMonths,
  compactPeso,
  monthLabel,
  monthParam,
  monthlySummary,
  monthsBetween,
  niceAxis,
  portfolioRates,
  reportData,
  type ReportTrends,
  type TrendMonth,
} from "@/lib/reports/report-utils";

export const metadata = { title: "Trends & analytics" };

const BASE = "/dashboard/reports/analytics";
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// RP8 (Nov 12): Trends & analytics. The four PB-39 metrics stay as chosen in DECISIONS_LOG.md.
// Before: the loans were read in one request, which the database cuts at 1,000 rows, so the rates, the average and
// the monthly volume used only 1,000 of the 1,262 loans; archived loans (removed records) were counted; the
// monthly chart skipped months with no loans; and the page didn't show how many loans each rate counted.
// RP9 (Nov 12): the database counts the loans per status and per month, so no loan rows are sent to the page.
//
// TA1–TA8 (Nov 14, after the Trends & analytics review). The PB-39 rules are NOT changed:
//   redemption rate = redeemed ÷ concluded; "forfeiture rate" = (defaulted + forfeited) ÷ concluded;
//   concluded = redeemed + defaulted + forfeited; average loan = all principal ÷ all loans (portfolioRates).
// - TA1: a period (From month / To month, plus All loans, Last 12 months, This year), PB-39 acceptance criterion 2
//   ("Given a date range filter is applied, then the visualizations update accordingly"), which the page didn't
//   have. The figures count the loans MADE in those months (by loan date), read by report_loan_trends (0072).
//   Default: all loans, the same numbers as before.
// - TA2: "Forfeiture rate" is now called "Default & forfeiture rate", because it counts Defaulted loans too (a
//   Defaulted loan can still be reinstated; a Forfeited one is final). Same calculation, clearer name.
// - TA3: the four boxes are compact like the other reports, each with the exact counts behind it.
// - TA4: "Where these loans stand today": one bar with Redeemed, Defaulted, Forfeited and Running shown apart, as
//   shares of ALL loans in the period (a different base from the two rates, and it says so).
// - TA5: the monthly volume is a column chart (one per month, months with no loans show ₱0 and count in the
//   average); the current month is marked "to date" and left out of the average per full month; "Show all 12
//   months" switches to the Last 12 months period. The exact amounts are in a table (opens on screen, always printed).
// - TA6: the long "how the rates are counted" box is now a closed "How these figures are worked out" section.
// Before TA: four large cards, the long explanation box open above the chart, and a list of 12 bars.
export default async function AnalyticsDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const today = manilaToday();
  const current = today.slice(0, 7); // this month, 'YYYY-MM'
  const from = monthParam(sp.from);
  const to = monthParam(sp.to);
  const badMonth = (sp.from && !from) || (sp.to && !to);
  const problem =
    from && to && from > to
      ? "The start month is after the end month. Pick a start month on or before the end month."
      : to && to > current
        ? "The end month is after this month. Pick this month or an earlier one."
        : null;

  const supabase = await createClient();
  // read only: counts per status and per month, worked out by the database (Admin only there too)
  const r = reportData<ReportTrends>(await supabase.rpc("report_loan_trends", problem ? {} : { p_from: from ? `${from}-01` : undefined, p_to: to ? `${to}-01` : undefined }));

  const total = Number(r.total);
  const k = portfolioRates(r.by_status ?? {}, total, Number(r.principal_sum));
  const n = (s: string) => Number(r.by_status?.[s] ?? 0);
  const periodMonths = (r.months ?? []).filter((m) => m.in_range);
  const sum = monthlySummary(periodMonths, r.current_month);
  const last12 = { from: addMonths(r.current_month, -11), to: r.current_month };
  const thisYear = { from: `${r.current_month.slice(0, 4)}-01`, to: r.current_month };
  const isAll = !from && !to && !problem; // the default: every loan
  const isLast12 = !problem && r.from_month === last12.from && r.to_month === last12.to;
  const isThisYear = !problem && r.from_month === thisYear.from && r.to_month === thisYear.to;
  const href = (p?: { from: string; to: string }) => (p ? `${BASE}?from=${p.from}&to=${p.to}` : BASE);
  // the months the selects offer: from the first loan (or 12 months back, whichever is earlier) up to this month
  const options = monthsBetween(r.first_month < last12.from ? r.first_month : last12.from, r.current_month);
  const toDate = r.to_month === r.current_month; // the period ends with this month, which isn't over yet
  const period = `${isAll ? "All loans · " : ""}${monthLabel(r.from_month)}${r.from_month === r.to_month ? "" : ` – ${monthLabel(r.to_month)}`}${toDate ? ` (${monthLabel(r.current_month, true)} to ${formatDate(today)})` : ""}`;

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Trends & analytics"
        description="How loans end, the average loan and how much is lent each month, for the loans issued in the selected months."
        subtitle={problem ? undefined : `${period} · ${total.toLocaleString("en-PH")} loans issued · statuses as recorded ${formatDate(today)}`}
      />

      {/* TA1: the period. Whole months by loan date, so the chart and the boxes always cover the same loans */}
      <Card className="print:hidden">
        <form action={BASE} className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="from" className="block text-xs font-medium text-slate-600">
              Loans issued from
            </label>
            <select id="from" name="from" defaultValue={problem ? (from ?? r.from_month) : r.from_month} className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20">
              {options.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="to" className="block text-xs font-medium text-slate-600">
              To
            </label>
            <select id="to" name="to" defaultValue={problem ? (to && to <= r.current_month ? to : r.current_month) : r.to_month} className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20">
              {options.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                  {m === r.current_month ? " (to date)" : ""}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonClasses("primary")}>
            Update report
          </button>
          <span className="flex flex-wrap items-center gap-2 text-sm" aria-label="Quick periods">
            <Link href={href()} aria-current={isAll ? "true" : undefined} className={cx(buttonClasses("ghost"), isAll && "bg-navy-50 text-navy-900")}>
              All loans
            </Link>
            <Link href={href(last12)} aria-current={isLast12 ? "true" : undefined} className={cx(buttonClasses("ghost"), isLast12 && "bg-navy-50 text-navy-900")}>
              Last 12 months
            </Link>
            <Link href={href(thisYear)} aria-current={isThisYear ? "true" : undefined} className={cx(buttonClasses("ghost"), isThisYear && "bg-navy-50 text-navy-900")}>
              This year
            </Link>
          </span>
        </form>
      </Card>

      {badMonth && <Alert tone="warning">A month in the address wasn&apos;t a real month, so the default was used.</Alert>}

      {problem ? (
        <Alert tone="warning" title="Check the months">
          {problem}
        </Alert>
      ) : (
        <>
          {/* TA7 (Nov 14): the period picks loans by the month they were issued; the statuses are the ones recorded
              today. Said once here, in plain view (before, only inside "How these figures are worked out") */}
          <p className="rounded-md border border-navy-100 bg-navy-50 px-3 py-2 text-sm text-slate-700">
            The months pick loans by the month they were <strong>issued</strong> (loan date). Each loan&apos;s status (redeemed, defaulted, forfeited
            or still running) is its status <strong>recorded today</strong>, so loans issued recently are more likely to still be running.
          </p>

          {/* TA3: the four PB-39 figures, compact, each with the counts it is worked out from */}
          <section aria-labelledby="ta-summary" className="break-inside-avoid">
            <h2 id="ta-summary" className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Summary · {period}
            </h2>
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div className={cx("rounded-md border border-l-4 border-slate-200 bg-white px-3 py-2", k.concluded ? "border-l-emerald-600" : "border-l-slate-300")}>
                <dt className="text-xs font-medium text-slate-600">Redemption rate</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{k.concluded ? pct(k.redemptionRate) : "N/A"}</dd>
                <dd className="text-xs text-slate-500">{k.concluded ? `${k.redeemed.toLocaleString("en-PH")} redeemed of ${k.concluded.toLocaleString("en-PH")} concluded loans` : "No loan in this period has concluded yet"}</dd>
              </div>
              <div className={cx("rounded-md border border-l-4 border-slate-200 bg-white px-3 py-2", k.defaulted + k.forfeited ? "border-l-red-700" : "border-l-slate-300")}>
                {/* TA2: PB-39's "forfeiture rate" counts Defaulted loans too, so the name says so */}
                <dt className="text-xs font-medium text-slate-600">Default &amp; forfeiture rate</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{k.concluded ? pct(k.forfeitureRate) : "N/A"}</dd>
                <dd className="text-xs text-slate-500">
                  {k.concluded ? `${k.defaulted} defaulted + ${k.forfeited} forfeited of ${k.concluded.toLocaleString("en-PH")} concluded loans` : "No loan in this period has concluded yet"}
                </dd>
              </div>
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                <dt className="text-xs font-medium text-slate-600">Average loan principal</dt>
                <dd className="mt-0.5 whitespace-nowrap text-lg font-semibold tabular-nums text-slate-900">{total ? formatPeso(k.averageLoan) : "N/A"}</dd>
                <dd className="text-xs text-slate-500">{total ? `Across all ${total.toLocaleString("en-PH")} loans issued` : "No loans issued in this period"}</dd>
              </div>
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                <dt className="text-xs font-medium text-slate-600">Loans issued</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{total.toLocaleString("en-PH")}</dd>
                <dd className="whitespace-nowrap text-xs text-slate-500">{formatPeso(Number(r.principal_sum))} principal lent</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-slate-600">
              {k.concluded === 0 ? (
                "The two rates count concluded loans only (redeemed, defaulted or forfeited). No loan issued in this period has concluded yet, so both show N/A."
              ) : (
                <>
                  The two rates count concluded loans only ({k.concluded.toLocaleString("en-PH")}: redeemed, defaulted or forfeited), so together they make
                  100%. The {k.running.toLocaleString("en-PH")} loans still running are in neither rate. A Defaulted loan can still be reinstated, so the
                  Default &amp; forfeiture rate can go down later.
                </>
              )}
            </p>
          </section>

          <StatusSection
            total={total}
            parts={[
              { key: "redeemed", label: "Redeemed", n: k.redeemed, swatch: "bg-emerald-600", note: "Paid in full, item returned" },
              { key: "defaulted", label: "Defaulted", n: k.defaulted, swatch: "bg-orange-500", note: "Not paid after the grace days; can still be reinstated" },
              { key: "forfeited", label: "Forfeited", n: k.forfeited, swatch: "bg-red-700", note: "Closed for good; the item is shop property" },
              {
                key: "open",
                label: "Still running",
                n: k.running,
                swatch: "bg-navy-400",
                note: `Active ${n("active")} · Renewed ${n("extended")} · Reinstated ${n("reinstated")}`,
              },
            ]}
            linkToLoans={isAll}
          />

          <section className="break-inside-avoid">
            <SectionTitle
              description="Principal lent each month, by the month the loans were issued. Months with no loans show ₱0 and still count in the average."
              actions={
                // TA5: the full 12-month view (the Last 12 months period), and back
                isLast12 ? (
                  <Link href={href()} className="text-sm font-medium text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 print:hidden">
                    Show all loans instead
                  </Link>
                ) : periodMonths.length < 12 ? (
                  <Link href={href(last12)} className="text-sm font-medium text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 print:hidden">
                    Show all 12 months
                  </Link>
                ) : undefined
              }
            >
              Monthly loan volume
            </SectionTitle>
            <Card>
              {r.months_capped && (
                <p className="mb-3 text-xs text-slate-600">The period is longer than 36 months, so the chart shows the newest 36. The boxes above count the whole period.</p>
              )}
              <MonthChart months={periodMonths} current={r.current_month} />
              {/* the chart's figures in words */}
              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 border-t border-slate-200 pt-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="inline text-slate-600">Total in these months: </dt>
                  <dd className="inline font-semibold tabular-nums text-navy-900">
                    {formatPeso(sum.principal)} · {sum.count.toLocaleString("en-PH")} loan{sum.count === 1 ? "" : "s"}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-slate-600">Average per full month: </dt>
                  <dd className="inline font-semibold tabular-nums text-navy-900">
                    {sum.averagePerFullMonth === null ? "— (no full month yet)" : formatPeso(sum.averagePerFullMonth)}
                    {sum.averagePerFullMonth !== null && (
                      <span className="ml-1 text-xs font-normal text-slate-500">
                        over {sum.fullMonths} month{sum.fullMonths === 1 ? "" : "s"}
                        {sum.emptyMonths ? `, ${sum.emptyMonths} with no loans` : ""}
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
              {sum.hasMonthToDate && (
                <p className="mt-1 text-xs text-slate-600">
                  {monthLabel(r.current_month)} is month to date (up to {formatDate(today)}), so it is in the total but not in the average.
                </p>
              )}
              {/* the exact amounts: a table that opens on screen, and is always on paper */}
              <details className="mt-3 text-sm print:hidden">
                <summary className="w-fit cursor-pointer rounded font-medium text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
                  Monthly figures as a table
                </summary>
                <div className="mt-2">
                  <MonthTable months={periodMonths} current={r.current_month} total={sum} />
                </div>
              </details>
              <div className="mt-3 hidden print:block">
                <MonthTable months={periodMonths} current={r.current_month} total={sum} />
              </div>
            </Card>
          </section>

          {/* TA6: the definitions, closed by default (they were an open box above the chart) */}
          <details className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 print:hidden">
            <summary className="cursor-pointer font-medium text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
              How these figures are worked out
            </summary>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li>
                <strong>Which loans:</strong> loans issued (by loan date) in the selected months, not archived. Their status is the one recorded today,
                so a recent period has more loans still running. A rate shows N/A when no loan in the period has concluded yet.
              </li>
              <li>
                <strong>Concluded loans</strong> = Redeemed ({k.redeemed}) + Defaulted ({k.defaulted}) + Forfeited ({k.forfeited}) = {k.concluded}.
              </li>
              <li>
                <strong>Redemption rate</strong> = Redeemed ÷ Concluded. <strong>Default &amp; forfeiture rate</strong> = (Defaulted + Forfeited) ÷
                Concluded. This is the PB-39 &quot;forfeiture rate&quot; (decisions log); it is named this way because it counts Defaulted loans as
                well as Forfeited ones. The two rates split the same concluded loans, so they always add up to 100%.
              </li>
              <li>
                <strong>Defaulted vs Forfeited:</strong> a Defaulted loan was not paid by the due date plus the grace days; a Cashier can still
                reinstate it. A Forfeited loan was closed for good by an Admin and its item belongs to the shop.
              </li>
              <li>
                <strong>Still running</strong> (in neither rate): Active ({n("active")}), Renewed ({n("extended")}), Reinstated ({n("reinstated")}) ={" "}
                {k.running}.
              </li>
              <li>
                <strong>Where these loans stand today</strong> shows shares of all {total.toLocaleString("en-PH")} loans, so its Redeemed share is not
                the redemption rate (that one counts concluded loans only).
              </li>
              <li>
                <strong>Average loan principal</strong> = all principal lent ÷ all loans issued in the period. <strong>Monthly loan volume</strong> = the
                principal of the loans issued in each month; months with no loans count as ₱0; the current month is month to date.
              </li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}

// TA4: one bar, four parts, and a legend with the count, the share and what each status means (never colour alone)
function StatusSection({
  total,
  parts,
  linkToLoans,
}: {
  total: number;
  parts: { key: string; label: string; n: number; swatch: string; note: string }[];
  linkToLoans: boolean;
}) {
  const share = (x: number) => (total ? pct(x / total) : "0.0%");
  return (
    <section className="break-inside-avoid">
      <SectionTitle description={`Each loan issued in the period by its status recorded today, as a share of all ${total.toLocaleString("en-PH")} loans.`}>
        Where these loans stand today
      </SectionTitle>
      <Card>
        {total ? (
          <>
            <div
              role="img"
              aria-label={parts.map((p) => `${p.label} ${p.n} (${share(p.n)})`).join(", ")}
              className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
            >
              {parts
                .filter((p) => p.n > 0)
                .map((p) => (
                  <span key={p.key} className={cx("h-full border-r border-white last:border-r-0", p.swatch)} style={{ width: `${(p.n / total) * 100}%` }} />
                ))}
            </div>
            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {parts.map((p) => (
                <div key={p.key} className="flex gap-2">
                  <span aria-hidden className={cx("mt-1 h-3 w-3 shrink-0 rounded-sm [-webkit-print-color-adjust:exact] [print-color-adjust:exact]", p.swatch)} />
                  <div className="min-w-0">
                    <dt className="text-sm font-medium text-slate-900">
                      {linkToLoans ? (
                        // the Loans page lists all loans (it has no period), so the link is only offered for All loans
                        <Link href={`/dashboard/loans?status=${p.key}`} className="hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 print:no-underline">
                          {p.label}
                        </Link>
                      ) : (
                        p.label
                      )}
                    </dt>
                    <dd className="text-sm tabular-nums text-slate-900">
                      <span className="font-semibold">{p.n.toLocaleString("en-PH")}</span> <span className="text-slate-500">· {share(p.n)} of all loans</span>
                    </dd>
                    <dd className="text-xs text-slate-500">{p.note}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <EmptyState icon="chart" title="No loans were issued in this period" />
        )}
      </Card>
    </section>
  );
}

// TA5: a column per month on a money axis with round steps. Each column has its amount written above it (from the
// sm size up) and in full for screen readers; nothing needs hovering. The current month is drawn hatched and
// labelled "to date"
function MonthChart({ months, current }: { months: TrendMonth[]; current: string }) {
  const max = Math.max(0, ...months.map((m) => Number(m.totalPrincipal)));
  const { top, step } = niceAxis(max);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  if (!months.length) return <EmptyState icon="chart" title="No months to show" />;
  // no money lent in any of these months: say so instead of an empty chart on a made-up ₱1–₱4 scale
  if (max === 0)
    return (
      <p className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-600">
        No loans were issued in {months.length === 1 ? monthLabel(months[0].month) : `${monthLabel(months[0].month)} – ${monthLabel(months[months.length - 1].month)}`}{" "}
        (₱0 in each month).
      </p>
    );
  return (
    <figure>
      <figcaption className="sr-only">Principal lent per month</figcaption>
      <div className="flex gap-2">
        {/* the money axis */}
        <div aria-hidden className="relative h-56 w-11 shrink-0 text-right text-[11px] tabular-nums text-slate-500">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 translate-y-1/2" style={{ bottom: `${(t / top) * 100}%` }}>
              {compactPeso(t)}
            </span>
          ))}
        </div>
        <div className="relative h-56 min-w-0 flex-1 border-b border-slate-300">
          {ticks.slice(1).map((t) => (
            <span key={t} aria-hidden className="absolute inset-x-0 border-t border-dashed border-slate-200" style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
          <ol className="absolute inset-0 flex items-end gap-1 sm:gap-3" aria-label="Principal lent per month">
            {months.map((m) => {
              const v = Number(m.totalPrincipal);
              const h = top ? (v / top) * 100 : 0;
              const mtd = m.month === current;
              return (
                <li key={m.month} className="relative flex h-full flex-1 justify-center">
                  <span className="sr-only">
                    {monthLabel(m.month)}
                    {mtd ? " (month to date)" : ""}: {formatPeso(v)} lent in {m.count} loan{m.count === 1 ? "" : "s"}
                  </span>
                  {v > 0 && (
                    <span
                      aria-hidden
                      className={cx(
                        "absolute bottom-0 w-full max-w-16 rounded-t [-webkit-print-color-adjust:exact] [print-color-adjust:exact]",
                        mtd ? "border-2 border-b-0 border-dashed border-navy-700 bg-navy-100" : "bg-navy-700",
                      )}
                      style={{ height: `${Math.max(h, 0.8)}%` }}
                    />
                  )}
                  <span aria-hidden className="absolute hidden whitespace-nowrap text-[11px] font-medium tabular-nums text-slate-700 sm:block" style={{ bottom: `calc(${h}% + 2px)` }}>
                    {compactPeso(v)}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      {/* the months under the columns */}
      <div aria-hidden className="ml-[3.25rem] mt-1 flex gap-1 text-center text-[11px] leading-tight text-slate-600 sm:gap-3">
        {months.map((m, i) => (
          <span key={m.month} className="min-w-0 flex-1">
            <span className={cx("block", m.month === current && "font-semibold text-navy-900")}>{monthLabel(m.month, true)}</span>
            {m.month === current ? (
              <span className="block text-[10px] text-navy-700">to date</span>
            ) : (
              // the year under the first month and every January ('25 on a phone, where 2025 and 2026 side by side touch)
              (i === 0 || m.month.endsWith("-01")) && (
                <span className="block text-[10px] text-slate-500">
                  <span className="sm:hidden">&rsquo;{m.month.slice(2, 4)}</span>
                  <span className="hidden sm:inline">{m.month.slice(0, 4)}</span>
                </span>
              )
            )}
          </span>
        ))}
      </div>
    </figure>
  );
}

function MonthTable({ months, current, total }: { months: TrendMonth[]; current: string; total: ReturnType<typeof monthlySummary> }) {
  return (
    <Table minWidth="320px" className="print:[&_tr]:break-inside-avoid">
      <THead>
        <TH>Month</TH>
        <TH align="right">Loans issued</TH>
        <TH align="right">Principal lent</TH>
      </THead>
      <TBody>
        {months.map((m) => (
          <TR key={m.month}>
            <TD>
              {monthLabel(m.month)}
              {m.month === current && <span className="ml-1 text-xs text-slate-500">(month to date)</span>}
            </TD>
            <TD align="right" className="tabular-nums">
              {Number(m.count).toLocaleString("en-PH")}
            </TD>
            <TD align="right" className="tabular-nums">
              {formatPeso(Number(m.totalPrincipal))}
            </TD>
          </TR>
        ))}
        <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
          <TD>Total</TD>
          <TD align="right" className="tabular-nums">
            {total.count.toLocaleString("en-PH")}
          </TD>
          <TD align="right" className="tabular-nums">
            {formatPeso(total.principal)}
          </TD>
        </tr>
      </TBody>
    </Table>
  );
}
