import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { entryTypeLabel } from "@/lib/finance/ledger"; // the Cash & ledger page's names for entry types
import { formatDate, formatPeso, manilaToday } from "@/lib/format";
import { ReportHeader } from "@/components/report-header";
import { Alert, Card, SectionTitle, Table, TBody, TD, TH, THead, TR, buttonClasses, cx } from "@/components/ui";
import { dateParam, reportData, type ReportCash } from "@/lib/reports/report-utils";

export const metadata = { title: "Financial summary" };

const BASE = "/dashboard/reports/financial-summary";

type LedgerPage = { total: number; sum_in: number; sum_out: number; rows: { amount: number }[] };

// RP6 (Nov 12): Financial summary.
// Before: the entries were read in one request, which the database cuts at 1,000 rows, so a long period gave
// wrong totals; nothing said the totals include auction-sale entries that are still under review; capitalized
// interest (no cash) was left out silently; and a date after today or a bad date was not explained.
// Now: Cash in / Cash out come from the same database function as the Cash & ledger page (cash_ledger_page),
// so the two pages always agree; the breakdown by type reads every entry (RP1) and is checked against those
// totals; entries under review and non-cash entries are shown separately; nothing is changed or reversed.
// RP9 (Nov 12): the breakdown is added up by the database too (report_cash_breakdown, migration 0066), with the
// same Manila day boundaries as cash_ledger_page. Before RP9 every entry of the period was read into the server.
// FS1–FS6 (Nov 13, after the Financial summary review; no database change, the figures come from the same functions):
// - "Net cash movement" (was "Change for the period"), with a line saying it is not profit, loss or cash on hand;
// - the three totals as compact boxes like the other reports (Cash received, Cash paid out, Net cash movement);
// - This month / Last month next to the dates;
// - the breakdown says Cash received / Cash paid out, each type opens its entries in Cash & ledger for the same
//   days, the non-cash entries sit under it with their own link, and a link opens all entries of the period;
// - the entries-under-review warning only when this period has some, with a link to just those entries;
// - a printed line saying this is a ledger summary, not a certified, audited or reconciled statement.
export default async function FinancialSummaryReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const today = manilaToday();
  const thisMonthStart = `${today.slice(0, 8)}01`;
  const lastMonth = previousMonth(today); // FS3: the first and last day of last month
  const rangeStart = dateParam(sp.from) ?? thisMonthStart; // default: this month so far
  const rangeEnd = dateParam(sp.to) ?? today;
  const badDate = (sp.from && !dateParam(sp.from)) || (sp.to && !dateParam(sp.to));
  const problem = rangeStart > rangeEnd ? "The start date is after the end date. Pick a start date on or before the end date." : rangeEnd > today ? "The end date is after today. Pick today or an earlier day." : null;

  const supabase = await createClient();
  let totals: LedgerPage | null = null;
  let review: LedgerPage | null = null;
  let breakdown: ReportCash | null = null;
  if (!problem) {
    const [t, r, b] = await Promise.all([
      // the same totals as Cash & ledger, worked out by the database for these Manila days
      supabase.rpc("cash_ledger_page", { p_from: rangeStart, p_to: rangeEnd, p_page: 1, p_size: 5 }),
      // the auction-sale entries with no sale record (the "needs checking" list), inside this period
      supabase.rpc("cash_ledger_page", { p_from: rangeStart, p_to: rangeEnd, p_check: true, p_page: 1, p_size: 100 }),
      // the breakdown by type, and the non-cash entries (capitalized interest) on their own
      supabase.rpc("report_cash_breakdown", { p_from: rangeStart, p_to: rangeEnd }),
    ]);
    totals = reportData<LedgerPage>(t);
    review = reportData<LedgerPage>(r);
    breakdown = reportData<ReportCash>(b);
  }

  // cash per entry type (the database already left the non-cash entries out of these)
  const byType = new Map((breakdown?.by_type ?? []).map((x) => [x.entry_type, { in: Number(x.cash_in), out: Number(x.cash_out), count: Number(x.count) }]));
  const nonCash = { count: Number(breakdown?.non_cash_count ?? 0), amount: Number(breakdown?.non_cash_amount ?? 0) };
  const cashIn = Number(totals?.sum_in ?? 0);
  const cashOut = Number(totals?.sum_out ?? 0);
  const net = round2(cashIn - cashOut);
  const breakdownIn = round2([...byType.values()].reduce((s, t) => s + t.in, 0));
  const breakdownOut = round2([...byType.values()].reduce((s, t) => s + t.out, 0));
  const cashEntries = [...byType.values()].reduce((s, t) => s + t.count, 0);
  // the breakdown adds up to the Cash & ledger totals, and every entry is either cash or non-cash
  const agrees = round2(cashIn) === breakdownIn && round2(cashOut) === breakdownOut && (breakdown?.entries ?? 0) === (totals?.total ?? 0);
  const reviewCount = review?.total ?? 0;
  const reviewSum = round2((review?.rows ?? []).reduce((s, x) => s + Number(x.amount), 0)); // from the rows sent (at most 100; 22 today)
  const reviewPartial = (review?.rows ?? []).length < reviewCount; // more than 100: say the amount is for the first 100 only
  const period = `${formatDate(rangeStart)} – ${formatDate(rangeEnd)}`;
  // FS4: Cash & ledger for exactly these days (it reads the same from / to), optionally one type or flow
  const ledgerHref = (extra: Record<string, string> = {}) => `/dashboard/finance?${new URLSearchParams({ ...extra, from: rangeStart, to: rangeEnd }).toString()}`;
  const preset = (from: string, to: string) => `${BASE}?from=${from}&to=${to}`;
  const isThisMonth = rangeStart === thisMonthStart && rangeEnd === today;
  const isLastMonth = rangeStart === lastMonth.from && rangeEnd === lastMonth.to;
  const signed = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}${formatPeso(Math.abs(n))}`; // a real minus sign, never colour alone

  return (
    <div className="space-y-4">
      <ReportHeader
        title="Financial summary"
        description="Review cash received, cash paid out and net cash movement for a selected period, based on the cash ledger."
        subtitle={`${period} (Manila days)${reviewCount ? ` · includes ${reviewCount} entr${reviewCount === 1 ? "y" : "ies"} under review` : ""}`}
      />

      {/* FS3: the period, the same controls as before plus This month / Last month */}
      <Card className="print:hidden">
        <form action={BASE} className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="from" className="block text-xs font-medium text-slate-600">
              From
            </label>
            <input id="from" name="from" type="date" defaultValue={rangeStart} max={today} className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20" />
          </div>
          <div>
            <label htmlFor="to" className="block text-xs font-medium text-slate-600">
              To
            </label>
            <input id="to" name="to" type="date" defaultValue={rangeEnd} max={today} className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20" />
          </div>
          <button type="submit" className={buttonClasses("primary")}>
            Update report
          </button>
          <span className="flex flex-wrap items-center gap-2 text-sm" aria-label="Quick periods">
            <Link href={preset(thisMonthStart, today)} aria-current={isThisMonth ? "true" : undefined} className={cx(buttonClasses("ghost"), isThisMonth && "bg-navy-50 text-navy-900")}>
              This month
            </Link>
            <Link href={preset(lastMonth.from, lastMonth.to)} aria-current={isLastMonth ? "true" : undefined} className={cx(buttonClasses("ghost"), isLastMonth && "bg-navy-50 text-navy-900")}>
              Last month
            </Link>
          </span>
        </form>
      </Card>

      {badDate && <Alert tone="warning">A date in the address wasn&apos;t a real date, so the default was used.</Alert>}

      {problem ? (
        <Alert tone="warning" title="Check the dates">
          {problem}
        </Alert>
      ) : (
        <>
          {/* FC1 / FS5: the totals include entries that still need an accounting decision; say so only when this
              period has some, never hide or change them */}
          {reviewCount > 0 && (
            <Alert tone="warning" title={`This period includes ${reviewCount} entr${reviewCount === 1 ? "y" : "ies"} that need${reviewCount === 1 ? "s" : ""} accounting review (${reviewPartial ? "first 100: " : ""}${formatPeso(reviewSum)})`}>
              Auction-sale money recorded in the ledger whose item has no sale record. It is counted in Cash received as it was recorded; nothing was changed
              or reversed.{" "}
              <Link href={ledgerHref({ check: "1" })} className="font-medium underline print:hidden">
                See these entries in Cash &amp; ledger
              </Link>
            </Alert>
          )}

          {/* FS2: the three totals; Net cash movement is the result, so it stands out (navy), and it says what it is not */}
          <section aria-label="Totals for the period" className="break-inside-avoid">
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
                <dt className="text-xs font-medium text-slate-600">Cash received</dt>
                <dd className="mt-0.5 whitespace-nowrap text-xl font-semibold tabular-nums text-emerald-800">{formatPeso(cashIn)}</dd>
                <dd className="text-xs text-slate-500">Money that came in</dd>
              </div>
              <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
                <dt className="text-xs font-medium text-slate-600">Cash paid out</dt>
                <dd className="mt-0.5 whitespace-nowrap text-xl font-semibold tabular-nums text-slate-900">{formatPeso(cashOut)}</dd>
                <dd className="text-xs text-slate-500">Money that went out (loans given out count here)</dd>
              </div>
              <div className="rounded-md border border-navy-200 bg-navy-50 px-4 py-3">
                <dt className="text-xs font-medium text-slate-600">Net cash movement</dt>
                <dd className="mt-0.5 whitespace-nowrap text-xl font-semibold tabular-nums text-navy-900">{signed(net)}</dd>
                {/* the sign in words on its own line (on one line with the amount it pushed the page sideways at 125% zoom) */}
                <dd className="text-xs text-slate-500">
                  Cash received minus cash paid out{net !== 0 ? (net < 0 ? ": more paid out than received" : ": more received than paid out") : ""}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-slate-600">
              Net cash movement is cash received minus cash paid out during the selected period. It is not the business&apos;s profit or loss, and not the
              cash on hand: a loan given out is cash paid out but not an expense.
            </p>
          </section>

          <section className="break-inside-avoid">
            <SectionTitle
              description={`${cashEntries.toLocaleString("en-PH")} cash entr${cashEntries === 1 ? "y" : "ies"}${nonCash.count ? ` + ${nonCash.count} non-cash` : ""} = ${(totals?.total ?? 0).toLocaleString("en-PH")} ledger entries in this period.`}
            >
              Breakdown by transaction type
            </SectionTitle>
            <Card padded={false}>
              <Table minWidth="520px" className="print:[&_tr]:break-inside-avoid">
                <THead>
                  <TH>Transaction type</TH>
                  <TH align="right">Entries</TH>
                  <TH align="right">Cash received</TH>
                  <TH align="right">Cash paid out</TH>
                </THead>
                <TBody>
                  {[...byType.entries()]
                    .sort((a, b) => entryTypeLabel(a[0]).localeCompare(entryTypeLabel(b[0])))
                    .map(([type, t]) => (
                      <TR key={type}>
                        <TD>
                          {/* FS4: the type opens its own entries in Cash & ledger, same days */}
                          <Link href={ledgerHref({ type })} className="text-navy-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 print:text-slate-900">
                            {entryTypeLabel(type)}
                          </Link>
                        </TD>
                        <TD align="right" className="tabular-nums">
                          {t.count}
                        </TD>
                        <TD align="right" className="tabular-nums">
                          {t.in ? formatPeso(round2(t.in)) : "—"}
                        </TD>
                        <TD align="right" className="tabular-nums">
                          {t.out ? formatPeso(round2(t.out)) : "—"}
                        </TD>
                      </TR>
                    ))}
                  {byType.size === 0 && (
                    <tr>
                      <TD colSpan={4} className="text-slate-500">
                        No cash activity in this period.
                      </TD>
                    </tr>
                  )}
                  {byType.size > 0 && (
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                      <TD>Total · all cash entries</TD>
                      <TD align="right" className="tabular-nums">
                        {cashEntries}
                      </TD>
                      <TD align="right" className="tabular-nums">
                        {formatPeso(breakdownIn)}
                      </TD>
                      <TD align="right" className="tabular-nums">
                        {formatPeso(breakdownOut)}
                      </TD>
                    </tr>
                  )}
                </TBody>
              </Table>
              {/* capitalized interest is written in the ledger but moves no cash, so it is never counted as cash received */}
              <div className="border-t border-slate-200 px-4 py-2.5 text-sm text-slate-700">
                <span className="font-medium text-slate-900">Non-cash entries</span> (no money changed hands; not counted above):{" "}
                {nonCash.count ? (
                  <>
                    interest added to the principal, {nonCash.count} entr{nonCash.count === 1 ? "y" : "ies"} · {formatPeso(round2(nonCash.amount))}.{" "}
                    <Link href={ledgerHref({ flow: "noncash" })} className="font-medium text-navy-700 hover:underline print:hidden">
                      View
                    </Link>
                  </>
                ) : (
                  "none in this period."
                )}
              </div>
              {(totals?.total ?? 0) > 0 && (
                <p className="border-t border-slate-200 px-4 py-2.5 text-sm print:hidden">
                  <Link href={ledgerHref()} className="font-medium text-navy-700 hover:underline">
                    View the {(totals?.total ?? 0).toLocaleString("en-PH")} ledger entries of {period} in Cash &amp; ledger
                  </Link>
                </p>
              )}
            </Card>
            {!agrees && (
              <Alert tone="danger" className="mt-3" title="The breakdown doesn't match the ledger totals">
                Reload the page. If it still doesn&apos;t match, tell the developers; use the Cash &amp; ledger totals meanwhile.
              </Alert>
            )}
          </section>

          {/* FS6: printed too, so a printout is never mistaken for an official statement */}
          <p className="text-xs text-slate-500">
            A summary of the entries recorded in the PawnTrack cash ledger for {period} (Manila days). It is not a certified, audited or reconciled
            accounting statement, and not a count of the cash drawer.
          </p>
        </>
      )}
    </div>
  );
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** The first and last day (YYYY-MM-DD) of the month before the given Manila date. */
function previousMonth(today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate(); // day 0 of the next month = the last day of this one
  const mm = String(pm).padStart(2, "0");
  return { from: `${py}-${mm}-01`, to: `${py}-${mm}-${String(last).padStart(2, "0")}` };
}
