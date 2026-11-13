import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { entryTypeLabel } from "@/lib/finance/ledger"; // the Cash & ledger page's names for entry types
import { formatDate, formatPeso, manilaToday } from "@/lib/format";
import { ReportHeader } from "@/components/report-header";
import { Alert, Card, SectionTitle, StatCard, Table, TBody, TD, TH, THead, TR, buttonClasses } from "@/components/ui";
import { dateParam, reportData, type ReportCash } from "@/lib/reports/report-utils";

export const metadata = { title: "Financial summary" };

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
export default async function FinancialSummaryReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const today = manilaToday();
  const rangeStart = dateParam(sp.from) ?? `${today.slice(0, 8)}01`; // default: this month so far
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
  const breakdownIn = round2([...byType.values()].reduce((s, t) => s + t.in, 0));
  const breakdownOut = round2([...byType.values()].reduce((s, t) => s + t.out, 0));
  // the breakdown adds up to the Cash & ledger totals, and every entry is either cash or non-cash
  const agrees = round2(cashIn) === breakdownIn && round2(cashOut) === breakdownOut && (breakdown?.entries ?? 0) === (totals?.total ?? 0);
  const reviewCount = review?.total ?? 0;
  const reviewSum = round2((review?.rows ?? []).reduce((s, x) => s + Number(x.amount), 0)); // from the rows sent (at most 100; 22 today)
  const reviewPartial = (review?.rows ?? []).length < reviewCount; // more than 100: say the amount is for the first 100 only
  const period = `${formatDate(rangeStart)} – ${formatDate(rangeEnd)}`;

  return (
    <div className="space-y-6">
      <ReportHeader
        title="Financial summary"
        description="Cash in, cash out and the change for a period of Manila business days, from the cash ledger. A calculated summary, not a reconciled or certified statement."
        subtitle={`${period}${reviewCount ? ` · includes ${reviewCount} entr${reviewCount === 1 ? "y" : "ies"} under review` : ""}`}
      />

      <form action="/dashboard/reports/financial-summary" className="flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label htmlFor="from" className="block text-xs font-medium text-slate-600">
            From
          </label>
          <input id="from" name="from" type="date" defaultValue={rangeStart} max={today} className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="to" className="block text-xs font-medium text-slate-600">
            To
          </label>
          <input id="to" name="to" type="date" defaultValue={rangeEnd} max={today} className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button type="submit" className={buttonClasses("primary")}>
          Update report
        </button>
        {(sp.from || sp.to) && (
          <Link href="/dashboard/reports/financial-summary" className="py-2 text-sm font-medium text-navy-700 hover:underline">
            This month
          </Link>
        )}
      </form>

      {badDate && <Alert tone="warning">A date in the address wasn&apos;t a real date, so the default was used.</Alert>}

      {problem ? (
        <Alert tone="warning" title="Check the dates">
          {problem}
        </Alert>
      ) : (
        <>
          {/* FC1: the ledger balance includes entries that are still under review; say so, never hide or change them */}
          {reviewCount > 0 && (
            <Alert tone="warning" title={`This period includes ${reviewCount} entr${reviewCount === 1 ? "y" : "ies"} under review (${reviewPartial ? "first 100: " : ""}${formatPeso(reviewSum)})`}>
              Auction-sale money recorded in the ledger whose item has no sale record. It is counted in Cash in as it was recorded; nothing was changed or reversed.
              Matt and an Admin still have to decide what to do with these entries.{" "}
              <Link href="/dashboard/finance?check=1" className="font-medium underline print:hidden">
                See them in Cash &amp; ledger
              </Link>
            </Alert>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Cash in" value={formatPeso(cashIn)} tone="success" hint="Same total as Cash & ledger" />
            <StatCard label="Cash out" value={formatPeso(cashOut)} hint="Same total as Cash & ledger" />
            <StatCard label="Change for the period" value={formatPeso(round2(cashIn - cashOut))} tone={cashIn - cashOut < 0 ? "danger" : "gold"} hint="Cash in minus cash out" />
          </div>

          <section>
            <SectionTitle description={`${(totals?.total ?? 0).toLocaleString("en-PH")} ledger entries in this period.`}>Breakdown by type</SectionTitle>
            <Card padded={false}>
              <Table minWidth="520px">
                <THead>
                  <TH>Type</TH>
                  <TH align="right">Entries</TH>
                  <TH align="right">Cash in</TH>
                  <TH align="right">Cash out</TH>
                </THead>
                <TBody>
                  {[...byType.entries()]
                    .sort((a, b) => entryTypeLabel(a[0]).localeCompare(entryTypeLabel(b[0])))
                    .map(([type, t]) => (
                      <TR key={type}>
                        <TD>{entryTypeLabel(type)}</TD>
                        <TD align="right">{t.count}</TD>
                        <TD align="right">{t.in ? formatPeso(round2(t.in)) : ""}</TD>
                        <TD align="right">{t.out ? formatPeso(round2(t.out)) : ""}</TD>
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
                      <TD>Total cash</TD>
                      <TD align="right">{[...byType.values()].reduce((s, t) => s + t.count, 0)}</TD>
                      <TD align="right">{formatPeso(breakdownIn)}</TD>
                      <TD align="right">{formatPeso(breakdownOut)}</TD>
                    </tr>
                  )}
                </TBody>
              </Table>
              {/* capitalized interest is written in the ledger but moves no cash, so it is never counted as cash received */}
              <p className="border-t border-slate-200 px-4 py-2.5 text-sm text-slate-600">
                Non-cash entries (interest added to the principal, no money changed hands): {nonCash.count}
                {nonCash.count ? `, ${formatPeso(round2(nonCash.amount))}` : ""}. Not counted in Cash in or Cash out.
              </p>
            </Card>
            {!agrees && (
              <Alert tone="danger" className="mt-3" title="The breakdown doesn't match the ledger totals">
                Reload the page. If it still doesn&apos;t match, tell the developers; use the Cash &amp; ledger totals meanwhile.
              </Alert>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
