import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPeso } from "@/lib/format";
import { ReportHeader } from "@/components/report-header";
import { Card, EmptyState, Pagination, SearchBar, StatusBadge, Table, TBody, TD, TH, THead, TR, ActionsCell, ViewButton, pageParam } from "@/components/ui";
import { ViewToolbar } from "@/components/view-tabs"; // the shared row under the tabs ("Viewing" / "N matches")
import { NavSelect } from "@/components/nav-select"; // the same dropdown as Inventory's Category
import { stateBadge } from "@/lib/loans/display"; // the Loans page's state badge (Active / Renewed / Reinstated)
import { categoryLabel } from "@/lib/appraisal/valuation";
import { customerNo } from "@/lib/ref-numbers";
import { PrintScope, ShowAllLink, pageSizeFor, reportHref } from "../report-parts"; // "Show all on one page (for printing)", filter links
import { LOAN_SITUATIONS, reportData, type LoanSituation, type ReportLoans } from "@/lib/reports/report-utils";

export const metadata = { title: "Outstanding loans report" };

const BASE = "/dashboard/reports/outstanding";

// the Loans page's payment-situation badge for each situation ("Not due yet" has no badge there either)
const SITUATION_BADGE: Record<LoanSituation, { status: string; label: string } | null> = {
  overdue: { status: "pending", label: "Overdue" },
  due_soon: { status: "pending", label: "Due soon" },
  paid: { status: "redeemed", label: "Paid, ready to release" },
  not_due: null,
};

// RP3 (Nov 12): Outstanding loans.
// Before: a paid loan whose item wasn't released yet showed "Overdue" (any loan past its due date did), the
// badge didn't match the Loans page, there was no search or filter, and every open loan was on one long page.
// Now: the Loans page's own rules and badges (Active / Renewed / Reinstated + Overdue / Due soon / Paid, ready to
// release), "Owed now" = principal left + interest including after the due date (same as the loan page), a
// search and a Situation filter, 50 rows a page, and totals that always cover ALL matching loans.
// RP9 (Nov 12): the database works all of this out (report_loans, migration 0066) and sends only the page shown
// plus the totals. Before RP9 every open loan was read into the server and added up in TypeScript.
export default async function OutstandingLoansReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const show = (sp.show && sp.show in LOAN_SITUATIONS ? sp.show : "") as LoanSituation | "";
  const all = sp.all === "1"; // 1,000 rows on one page (for printing)

  const supabase = await createClient();
  const r = reportData<ReportLoans>(
    await supabase.rpc("report_loans", { p_report: "outstanding", p_q: q || undefined, p_filter: show || undefined, p_page: pageParam(sp.page), p_size: pageSizeFor(all) }),
  );
  const today = r.today; // the database's Manila date, so the page and the numbers agree
  const count = (k: LoanSituation) => Number(r.counts?.[k] ?? 0);

  const current = { q: q || undefined, show: show || undefined };
  const href = (change: Record<string, string | undefined>) => reportHref(BASE, current, change);
  const filtered = Boolean(q || show);

  return (
    <div>
      <ReportHeader
        title="Outstanding loans"
        description="Every open loan (Active, Renewed or Reinstated). Owed now = principal left + interest, including interest after the due date."
        subtitle={`${r.all_count} open loan${r.all_count === 1 ? "" : "s"} · ${formatPeso(r.all_owed)} owed now · as of ${formatDate(today)}${filtered ? ` · showing ${r.total} matching` : ""}`}
      />
      <Card padded={false}>
        <ViewToolbar viewing={show ? LOAN_SITUATIONS[show] : "All open loans"} matches={q ? r.total : undefined}>
          <div className="w-full sm:w-80">
            <SearchBar action={BASE} defaultValue={q} placeholder="Search customer, C-number or ticket" hidden={{ show: show || undefined }} />
          </div>
          <NavSelect
            label="Situation"
            value={show}
            options={[{ value: "", label: `All (${r.all_count})`, href: href({ show: undefined }) }].concat(
              (Object.keys(LOAN_SITUATIONS) as LoanSituation[]).map((k) => ({ value: k, label: `${LOAN_SITUATIONS[k]} (${count(k)})`, href: href({ show: k }) })),
            )}
          />
        </ViewToolbar>
        {r.total ? (
          <>
            <PrintScope page={r.page} size={r.size} total={r.total} shown={r.rows.length} all={all} />
            <Table minWidth="980px">
              <THead>
                <TH>Customer</TH>
                <TH>Ticket</TH>
                <TH>Item</TH>
                <TH align="right">Principal</TH>
                <TH align="right">Principal left</TH>
                <TH align="right">Interest now</TH>
                <TH align="right">Owed now</TH>
                <TH>Due</TH>
                <TH>Status</TH>
                {/* RP13 (Nov 13): "relative" keeps the hidden "Actions" label (sr-only = position: absolute) inside the table's
                    scroll box. Before: it escaped it and made the whole page scroll sideways on screens up to 1280 px wide. */}
                <TH className="relative print:hidden">
                  <span className="sr-only">Actions</span>
                </TH>
              </THead>
              <TBody>
                {r.rows.map((loan) => {
                  const state = stateBadge(loan.status);
                  const situation = loan.situation ? SITUATION_BADGE[loan.situation] : null;
                  return (
                    <TR key={loan.id} highlight={loan.situation === "overdue" ? "warning" : undefined}>
                      <TD>
                        {loan.customer_name ?? ""}
                        <span className="block font-mono text-xs text-slate-500">{customerNo(loan.customer_no)}</span>
                      </TD>
                      <TD mono>{loan.ticket_number}</TD>
                      <TD>{loan.category ? `${categoryLabel(loan.category, loan.category_other)}, ${loan.karat}K` : ""}</TD>
                      <TD align="right">{formatPeso(loan.principal_amount)}</TD>
                      <TD align="right">{formatPeso(loan.principal_balance)}</TD>
                      <TD align="right">{formatPeso(loan.interest_now)}</TD>
                      <TD align="right" className="font-medium">
                        {formatPeso(loan.owed)}
                      </TD>
                      <TD className="whitespace-nowrap">{formatDate(loan.maturity_date)}</TD>
                      <TD>
                        {/* the loan's state and, separately, its payment situation today (Loans page badges) */}
                        <span className="flex flex-wrap gap-1">
                          <StatusBadge status={state.status} label={state.label} />
                          {situation && <StatusBadge status={situation.status} label={situation.label} />}
                        </span>
                      </TD>
                      <ActionsCell>
                        <ViewButton href={`/dashboard/loans/${loan.id}`}>View loan</ViewButton>
                      </ActionsCell>
                    </TR>
                  );
                })}
                {/* the totals are for ALL matching loans, not only this page (added up by the database) */}
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                  <TD colSpan={3}>
                    Total, all {r.total} matching loan{r.total === 1 ? "" : "s"}
                  </TD>
                  <TD align="right">{formatPeso(r.totals.principal)}</TD>
                  <TD align="right">{formatPeso(r.totals.balance)}</TD>
                  <TD align="right">{formatPeso(r.totals.interest)}</TD>
                  <TD align="right">{formatPeso(r.totals.owed)}</TD>
                  <TD colSpan={2} />
                  <td className="print:hidden" />
                </tr>
              </TBody>
            </Table>
            <Pagination page={r.page} pageSize={r.size} total={r.total} basePath={BASE} params={{ ...current, all: all ? "1" : undefined }} />
            <ShowAllLink all={all} total={r.total} href={href({ all: all ? undefined : "1" })} />
          </>
        ) : (
          <EmptyState title={filtered ? "No loan matches" : "No open loans."} description={filtered ? "Try another search or All in Situation." : undefined} />
        )}
      </Card>
    </div>
  );
}
