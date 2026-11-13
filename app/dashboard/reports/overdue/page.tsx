import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPeso } from "@/lib/format";
import { ReportHeader } from "@/components/report-header";
import { Card, EmptyState, Pagination, SearchBar, StatusBadge, Table, TBody, TD, TH, THead, TR, ActionsCell, ViewButton, pageParam } from "@/components/ui";
import { ViewToolbar } from "@/components/view-tabs";
import { NavSelect } from "@/components/nav-select";
import { stateBadge } from "@/lib/loans/display";
import { customerNo } from "@/lib/ref-numbers";
import { OVERDUE_STAGES, reportData, type OverdueStage, type ReportLoans } from "@/lib/reports/report-utils";
import { PrintScope, ShowAllLink, pageSizeFor, reportHref } from "../report-parts";

export const metadata = { title: "Overdue loans report" };

const BASE = "/dashboard/reports/overdue";

const STAGE_TONE: Record<OverdueStage, string> = { in_grace: "pending", past_grace: "pending", defaulted: "defaulted" };
// RP13: short names for the Stage dropdown. Before: "Past grace (not marked Defaulted yet) (0)" made the dropdown wider
// than a phone screen (410 px on 360 px). The full names stay on the stage cards and in the table.
const STAGE_SHORT: Record<OverdueStage, string> = { in_grace: "In grace", past_grace: "Past grace", defaulted: "Defaulted" };

// RP4 (Nov 12): Overdue loans.
// Before: every loan past its due date was listed, so a fully paid loan waiting for its item to be released
// showed as overdue with ₱0 owed (the Loans page doesn't call those overdue), and there were no totals per stage.
// Now: the Loans page's rule (past due AND still owes money) plus Defaulted loans that still owe; each loan is
// In grace, Past grace (the default check will mark it Defaulted) or Defaulted. This report only reads: it never
// runs the default check and never changes a loan.
// RP9 (Nov 12): worked out by the database (report_loans, migration 0066); only the page shown is sent.
export default async function OverdueLoansReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const stage = (sp.stage && sp.stage in OVERDUE_STAGES ? sp.stage : "") as OverdueStage | "";
  const all = sp.all === "1";

  const supabase = await createClient();
  const r = reportData<ReportLoans>(
    await supabase.rpc("report_loans", { p_report: "overdue", p_q: q || undefined, p_filter: stage || undefined, p_page: pageParam(sp.page), p_size: pageSizeFor(all) }),
  );
  const count = (k: OverdueStage) => Number(r.counts?.[k] ?? 0);
  const sum = (k: OverdueStage) => Number(r.sums?.[k] ?? 0);
  const current = { q: q || undefined, stage: stage || undefined };
  const filtered = Boolean(q || stage);

  return (
    <div>
      <ReportHeader
        title="Overdue loans"
        description="Loans past their due date that still owe money, and Defaulted loans. Fully paid loans waiting for release are not overdue (same rule as the Loans page)."
        subtitle={`${r.all_count} overdue loan${r.all_count === 1 ? "" : "s"} · ${formatPeso(r.all_owed)} owed now · as of ${formatDate(r.today)}`}
      />

      {/* what each stage means and how much it holds (all overdue loans, before search) */}
      <dl className="mb-4 grid gap-3 sm:grid-cols-3">
        {(Object.keys(OVERDUE_STAGES) as OverdueStage[]).map((k) => (
          <div key={k} className="rounded-md border border-slate-200 bg-white px-4 py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{OVERDUE_STAGES[k]}</dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">
              {count(k)} <span className="text-sm font-normal text-slate-600">· {formatPeso(sum(k))}</span>
            </dd>
          </div>
        ))}
      </dl>

      <Card padded={false}>
        <ViewToolbar viewing={stage ? OVERDUE_STAGES[stage] : "All overdue loans"} matches={q ? r.total : undefined}>
          <div className="w-full sm:w-80">
            <SearchBar action={BASE} defaultValue={q} placeholder="Search customer, C-number or ticket" hidden={{ stage: stage || undefined }} />
          </div>
          <NavSelect
            label="Stage"
            value={stage}
            options={[{ value: "", label: `All (${r.all_count})`, href: reportHref(BASE, current, { stage: undefined }) }].concat(
              (Object.keys(OVERDUE_STAGES) as OverdueStage[]).map((k) => ({ value: k, label: `${STAGE_SHORT[k]} (${count(k)})`, href: reportHref(BASE, current, { stage: k }) })),
            )}
          />
        </ViewToolbar>
        {r.total ? (
          <>
            <PrintScope page={r.page} size={r.size} total={r.total} shown={r.rows.length} all={all} />
            <Table minWidth="860px">
              <THead>
                <TH>Customer</TH>
                <TH>Ticket</TH>
                <TH>Due</TH>
                <TH align="right">Days overdue</TH>
                <TH align="right">Owed now</TH>
                <TH>Stage</TH>
                {/* RP13 (Nov 13): "relative" keeps the hidden "Actions" label (sr-only = position: absolute) inside the table's
                    scroll box. Before: it escaped it and made the whole page scroll sideways on screens up to 1280 px wide. */}
                <TH className="relative print:hidden">
                  <span className="sr-only">Actions</span>
                </TH>
              </THead>
              <TBody>
                {r.rows.map((loan) => {
                  const st = loan.stage as OverdueStage; // every row of this report has a stage
                  return (
                    <TR key={loan.id} highlight={st === "in_grace" ? "warning" : "danger"}>
                      <TD>
                        {loan.customer_name ?? ""}
                        <span className="block font-mono text-xs text-slate-500">
                          {customerNo(loan.customer_no)} {loan.contact_number ? `· ${loan.contact_number}` : ""}
                        </span>
                      </TD>
                      <TD mono>{loan.ticket_number}</TD>
                      <TD className="whitespace-nowrap">{formatDate(loan.maturity_date)}</TD>
                      <TD align="right" className="font-semibold">
                        {loan.days_late}
                      </TD>
                      <TD align="right">{formatPeso(loan.owed)}</TD>
                      <TD>
                        <span className="flex flex-wrap gap-1">
                          <StatusBadge status={STAGE_TONE[st]} label={OVERDUE_STAGES[st]} />
                          {st !== "defaulted" && loan.status !== "active" && <StatusBadge status={loan.status} label={stateBadge(loan.status).label} />}
                        </span>
                        {st === "in_grace" && <span className="mt-0.5 block text-xs text-slate-600">Grace ends {formatDate(loan.grace_end)}</span>}
                      </TD>
                      <ActionsCell>
                        <ViewButton href={`/dashboard/loans/${loan.id}`}>View loan</ViewButton>
                      </ActionsCell>
                    </TR>
                  );
                })}
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                  <TD colSpan={4}>
                    Total, all {r.total} matching loan{r.total === 1 ? "" : "s"}
                  </TD>
                  <TD align="right">{formatPeso(r.totals.owed)}</TD>
                  <TD />
                  <td className="print:hidden" />
                </tr>
              </TBody>
            </Table>
            <Pagination page={r.page} pageSize={r.size} total={r.total} basePath={BASE} params={{ ...current, all: all ? "1" : undefined }} />
            <ShowAllLink all={all} total={r.total} href={reportHref(BASE, current, { all: all ? undefined : "1" })} />
          </>
        ) : (
          <EmptyState title={filtered ? "No loan matches" : "No overdue loans."} description={filtered ? "Try another search or All in Stage." : undefined} />
        )}
        {r.paid_past_due > 0 && (
          <p className="border-t border-slate-200 px-4 py-2.5 text-xs text-slate-600">
            Not listed: {r.paid_past_due} loan{r.paid_past_due === 1 ? " is" : "s are"} past the due date but fully paid, waiting for the item to be released (see Outstanding loans → Paid, ready to release).
          </p>
        )}
      </Card>
    </div>
  );
}
