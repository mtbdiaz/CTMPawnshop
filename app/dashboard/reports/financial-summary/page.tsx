import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { computeCashPosition } from "@/lib/finance/ledger";
import { formatDate, formatPeso, humanize, manilaDayEnd, manilaDayStart, manilaToday } from "@/lib/format";
import { ReportHeader } from "@/components/report-header";
import { Alert, Card, SectionTitle, StatCard, Table, TBody, TD, TH, THead, TR, buttonClasses } from "@/components/ui";

export const metadata = { title: "Financial summary" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function FinancialSummaryReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole(["admin"]);
  const { from, to } = await searchParams;

  const today = manilaToday();
  const rangeStart = from && DATE_RE.test(from) ? from : `${today.slice(0, 8)}01`;
  const rangeEnd = to && DATE_RE.test(to) ? to : today;
  const invalidRange = rangeStart > rangeEnd;

  const supabase = await createClient();
  const { data: entries, error } = invalidRange
    ? { data: [], error: null }
    : await supabase
        .from("cash_flow_entries")
        .select("amount, direction, entry_type")
        .gte("created_at", manilaDayStart(rangeStart))
        .lte("created_at", manilaDayEnd(rangeEnd));
  if (error) throw error;

  const rows = entries ?? [];
  const position = computeCashPosition(rows);
  const byType = new Map<string, { direction: string; amount: number; count: number }>();
  for (const e of rows) {
    const t = byType.get(e.entry_type) ?? { direction: e.direction, amount: 0, count: 0 };
    t.amount += Number(e.amount);
    t.count += 1;
    byType.set(e.entry_type, t);
  }

  return (
    <div className="space-y-6">
      <ReportHeader
        title="Financial summary"
        description="Cash in, cash out and net position for a date range (Manila business days)."
        subtitle={`${formatDate(rangeStart)} – ${formatDate(rangeEnd)}`}
      />

      <form action="/dashboard/reports/financial-summary" className="flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label htmlFor="from" className="block text-xs font-medium text-slate-600">
            From
          </label>
          <input id="from" name="from" type="date" defaultValue={rangeStart} max={today} className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="to" className="block text-xs font-medium text-slate-600">
            To
          </label>
          <input id="to" name="to" type="date" defaultValue={rangeEnd} max={today} className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button type="submit" className={buttonClasses("primary")}>
          Update report
        </button>
      </form>

      {invalidRange ? (
        <Alert tone="warning" title="The start date is after the end date">
          Pick a start date on or before the end date.
        </Alert>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Total cash in" value={formatPeso(position.totalIn)} tone="success" />
            <StatCard label="Total cash out" value={formatPeso(position.totalOut)} />
            <StatCard label="Net position" value={formatPeso(position.net)} tone={position.net < 0 ? "danger" : "gold"} />
          </div>

          <section>
            <SectionTitle>Breakdown by type</SectionTitle>
            <Card padded={false}>
              <Table minWidth="480px">
                <THead>
                  <TH>Type</TH>
                  <TH align="right">Entries</TH>
                  <TH align="right">Cash in</TH>
                  <TH align="right">Cash out</TH>
                </THead>
                <TBody>
                  {[...byType.entries()].map(([type, t]) => (
                    <TR key={type}>
                      <TD>{humanize(type)}</TD>
                      <TD align="right">{t.count}</TD>
                      <TD align="right">{t.direction === "in" ? formatPeso(t.amount) : ""}</TD>
                      <TD align="right">{t.direction === "out" ? formatPeso(t.amount) : ""}</TD>
                    </TR>
                  ))}
                  {byType.size === 0 && (
                    <tr>
                      <TD className="text-slate-500">No cash activity in this period.</TD>
                    </tr>
                  )}
                </TBody>
              </Table>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
