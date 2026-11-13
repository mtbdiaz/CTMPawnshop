import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPeso } from "@/lib/format";
import { ReportHeader } from "@/components/report-header";
import { Card, EmptyState, StatusBadge, Table, TBody, TD, TH, THead, TR, ActionsCell, ViewButton, buttonClasses, cx, pageParam } from "@/components/ui";
import { stateBadge } from "@/lib/loans/display"; // the Loans page's state badge (Active / Renewed / Reinstated)
import { categoryLabel } from "@/lib/appraisal/valuation";
import { customerNo } from "@/lib/ref-numbers";
import { PrintScope, ShowAllLink, reportHref } from "../report-parts"; // "Show all on one page (for printing)", filter links, print note
import { ReportPagination } from "../report-pagination"; // OL7: page numbers and Go to page (shared with the Audit Trail)
import {
  LOAN_SITUATIONS,
  LOAN_SORTS,
  OUTSTANDING_VIEWS,
  PRINT_LIMIT,
  dateParam,
  reportData,
  type LoanSituation,
  type LoanSort,
  type OutstandingView,
  type ReportLoans,
} from "@/lib/reports/report-utils";

export const metadata = { title: "Outstanding loans report" };

const BASE = "/dashboard/reports/outstanding";
const PAGE_SIZE = 10; // OL7 (Nov 13): 10 per page like the Audit Trail (was 50), so the report stays short

// the Loans page's payment-situation badge for each situation ("Not due yet" has no badge there either)
const SITUATION_BADGE: Record<LoanSituation, { status: string; label: string } | null> = {
  overdue: { status: "pending", label: "Overdue" },
  due_soon: { status: "pending", label: "Due soon" },
  // OL9 (Nov 13): "Ready to release" (was "Paid, ready to release"), the same words as this report's filter and
  // summary; the shorter badge keeps the Status and View loan columns on screen on a 1280px laptop
  paid: { status: "redeemed", label: "Ready to release" },
  not_due: null,
};

// RP3 (Nov 12): Outstanding loans: the Loans page's own rules and badges, "Owed now" = principal left + interest
// including after the due date, search and Situation, totals for ALL matching loans (worked out by the database).
// OL1–OL7 (Nov 13, after the Outstanding loans review):
// - a compact summary of every open loan above the table (count, overdue, ready to release, principal left,
//   interest now, owed now), from the database (report_loans all_totals, migration 0069);
// - views: All open loans (still the default, so the report stays complete), Owes money, its three situations,
//   and Ready to release, with a short note why a paid loan can still be open;
// - one filter row: search, situation, due date from / to, sort, Clear filters and Apply filters (sort and the
//   due range are done by the database, so the totals and pages stay correct);
// - the table: no amber row colour (the Overdue badge says it), the customer links to their page, the ticket to
//   the loan, Owed now in stronger text; the totals row says exactly which loans it adds up;
// - 10 per page with page numbers and Go to page; the printout states the scope and keeps each loan on one line.
// The rules for owed now, paid, overdue and due soon are not changed (same as the Loans page).
export default async function OutstandingLoansReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const show = (sp.show && sp.show in OUTSTANDING_VIEWS ? sp.show : "") as OutstandingView | "";
  const sort = (sp.sort && sp.sort in LOAN_SORTS ? sp.sort : "due") as LoanSort;
  const dueFrom = dateParam(sp.due_from);
  const dueTo = dateParam(sp.due_to);
  const badRange = Boolean(dueFrom && dueTo && dueFrom > dueTo); // explained below and not sent to the database
  const all = sp.all === "1"; // up to 1,000 rows on one page (for printing)

  const supabase = await createClient();
  const r = reportData<ReportLoans>(
    await supabase.rpc("report_loans", {
      p_report: "outstanding",
      p_q: q || undefined,
      p_filter: show || undefined,
      p_due_from: badRange ? undefined : dueFrom,
      p_due_to: badRange ? undefined : dueTo,
      p_sort: sort === "due" ? undefined : sort,
      p_page: pageParam(sp.page),
      p_size: all ? PRINT_LIMIT : PAGE_SIZE,
    }),
  );
  const today = r.today; // the database's Manila date, so the page and the numbers agree
  const count = (k: LoanSituation) => Number(r.counts?.[k] ?? 0);
  const owing = count("overdue") + count("due_soon") + count("not_due");
  const whole = r.all_totals ?? r.totals; // every open loan, before search and filters

  const current = { q: q || undefined, show: show || undefined, sort: sort === "due" ? undefined : sort, due_from: badRange ? undefined : dueFrom, due_to: badRange ? undefined : dueTo };
  const filtered = Boolean(q || show || (!badRange && (dueFrom || dueTo)));
  // OL6: the scope in words, used by the totals row, the list header and the printout
  const scope = [
    show ? OUTSTANDING_VIEWS[show] : "All open loans",
    q ? `search "${q}"` : "",
    !badRange && (dueFrom || dueTo) ? `due ${dueFrom ? formatDate(dueFrom) : "any time"} – ${dueTo ? formatDate(dueTo) : "any time"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const field = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20";

  return (
    <div>
      <ReportHeader
        title="Outstanding loans"
        description="Every open loan (Active, Renewed or Reinstated). Owed now = principal left + interest, including interest after the due date."
        subtitle={`As of ${formatDate(today)} · ${scope}${sort !== "due" ? ` · sorted by ${LOAN_SORTS[sort].toLowerCase()}` : ""}`}
      />

      {/* OL1: a compact overview of every open loan (not only the list below), from the database */}
      <section aria-labelledby="ol-summary" className="mb-4 break-inside-avoid">
        {/* says on screen and on paper that these boxes cover every open loan, even when the list below is filtered */}
        <h2 id="ol-summary" className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          All open loans · as of {formatDate(today)}
        </h2>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {[
            { label: "Open loans", value: r.all_count.toLocaleString("en-PH") },
            { label: "Overdue", value: count("overdue").toLocaleString("en-PH") },
            { label: "Ready to release", value: count("paid").toLocaleString("en-PH") },
            { label: "Principal left", value: formatPeso(whole.balance) },
            { label: "Interest now", value: formatPeso(whole.interest) },
            { label: "Owed now", value: formatPeso(whole.owed), strong: true },
          ].map((m) => (
            <div key={m.label} className={cx("rounded-md border bg-white px-3 py-2", m.strong ? "border-navy-200 bg-navy-50" : "border-slate-200")}>
              <dt className="text-xs font-medium text-slate-600">{m.label}</dt>
              <dd className={cx("mt-0.5 whitespace-nowrap font-semibold tabular-nums", m.strong ? "text-lg text-navy-900" : "text-base text-slate-900")}>{m.value}</dd>
            </div>
          ))}
        </dl>
        {/* OL2: why a fully paid loan can be in a report called Outstanding loans */}
        {count("paid") > 0 && (
          <p className="mt-2 text-xs text-slate-600">
            {count("paid")} loan{count("paid") === 1 ? " is" : "s are"} fully paid but still open: a paid loan stays open until the item is released to the
            customer.{" "}
            {/* how-to for the screen only (there are no filters on paper) */}
            <span className="print:hidden">
              Use Situation → Ready to release to list {count("paid") === 1 ? "it" : "them"}, or Owes money to leave {count("paid") === 1 ? "it" : "them"} out.
            </span>
          </p>
        )}
      </section>

      <Card padded={false}>
        {/* OL3: one filter row, aligned like the Audit Trail; everything is in the address, so paging and Back keep it */}
        {/* OL9 (Nov 13): the five filters share one row only from 1280px (xl; was 1024px, lg). Between 1024 and 1279px,
            e.g. a 1920 laptop at 150% Windows scaling zoomed to 125%, the row needed 928px in a 789px card and the whole
            page scrolled sideways; there they now sit two per row */}
        <form action={BASE} className="space-y-3 border-b border-slate-200 p-4 print:hidden">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,2fr)_minmax(11rem,1.3fr)_repeat(2,minmax(9rem,1fr))_minmax(12rem,1.3fr)]">
            <div className="sm:col-span-2 xl:col-span-1">
              <label htmlFor="q" className="block text-xs font-medium text-slate-600">
                Search
              </label>
              <input id="q" name="q" type="search" defaultValue={q} placeholder="Customer, C-number or ticket" className={field} />
            </div>
            <div>
              <label htmlFor="show" className="block text-xs font-medium text-slate-600">
                Situation
              </label>
              <select id="show" name="show" defaultValue={show} className={field}>
                <option value="">All open loans ({r.all_count})</option>
                <option value="owing">Owes money ({owing})</option>
                <optgroup label="Owes money, by situation">
                  {(["overdue", "due_soon", "not_due"] as const).map((k) => (
                    <option key={k} value={k}>
                      {LOAN_SITUATIONS[k]} ({count(k)})
                    </option>
                  ))}
                </optgroup>
                <option value="paid">Ready to release ({count("paid")})</option>
              </select>
            </div>
            <div>
              <label htmlFor="due_from" className="block text-xs font-medium text-slate-600">
                Due from
              </label>
              <input id="due_from" name="due_from" type="date" defaultValue={dueFrom ?? ""} className={field} />
            </div>
            <div>
              <label htmlFor="due_to" className="block text-xs font-medium text-slate-600">
                Due to
              </label>
              <input id="due_to" name="due_to" type="date" defaultValue={dueTo ?? ""} className={field} />
            </div>
            <div>
              <label htmlFor="sort" className="block text-xs font-medium text-slate-600">
                Sort by
              </label>
              <select id="sort" name="sort" defaultValue={sort} className={field}>
                {(Object.keys(LOAN_SORTS) as LoanSort[]).map((k) => (
                  <option key={k} value={k}>
                    {LOAN_SORTS[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {(filtered || sort !== "due" || badRange) && (
              <Link href={BASE} className={buttonClasses("ghost")}>
                Clear filters
              </Link>
            )}
            <button type="submit" className={buttonClasses("primary")}>
              Apply filters
            </button>
          </div>
        </form>

        {badRange && (
          <p className="border-b border-slate-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="status">
            The Due from date is after the Due to date, so the dates were not used. Pick a start date on or before the end date.
          </p>
        )}
        {/* OL6: what the list (and its totals row) covers */}
        <p className="border-b border-slate-200 px-4 py-2 text-sm text-slate-600 print:hidden" aria-live="polite">
          <span className="font-medium text-slate-900">{r.total.toLocaleString("en-PH")}</span> loan{r.total === 1 ? "" : "s"} · {scope}
          {sort !== "due" ? ` · ${LOAN_SORTS[sort]}` : ""}
        </p>

        {r.total ? (
          <>
            <PrintScope page={r.page} size={r.size} total={r.total} shown={r.rows.length} all={all} />
            {/* OL7: on paper a loan's row is never split across two pages */}
            {/* OL8 (Nov 13): the item now sits under its ticket (was its own column), so the table fits a 1366px laptop
                without scrolling sideways (before: 1,203px of table in a 1,093px box) */}
            {/* OL9 (Nov 13): 8px side padding in the cells (was 12px) so the table fits a 1280px laptop with the sidebar */}
            <Table minWidth="960px" className="print:[&_tr]:break-inside-avoid [&_td]:px-2 [&_th]:px-2">
              <THead>
                <TH>Customer</TH>
                <TH>Ticket and item</TH>
                <TH align="right">Principal</TH>
                <TH align="right">Principal left</TH>
                <TH align="right">Interest now</TH>
                <TH align="right">Owed now</TH>
                <TH>Due</TH>
                <TH>Status</TH>
                {/* RP13: "relative" keeps the hidden "Actions" label inside the table's scroll box (no sideways page scroll) */}
                <TH className="relative print:hidden">
                  <span className="sr-only">Actions</span>
                </TH>
              </THead>
              <TBody>
                {r.rows.map((loan) => {
                  const state = stateBadge(loan.status);
                  const situation = loan.situation ? SITUATION_BADGE[loan.situation] : null;
                  return (
                    // OL4: no amber row colour any more: the Overdue badge says it, in words
                    <TR key={loan.id}>
                      <TD>
                        {/* OL4: the customer opens their page; the C-number stays underneath */}
                        {loan.customer_id ? (
                          <Link href={`/dashboard/customers/${loan.customer_id}`} className="font-medium text-slate-900 hover:text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
                            {loan.customer_name ?? ""}
                          </Link>
                        ) : (
                          <span className="font-medium text-slate-900">{loan.customer_name ?? ""}</span>
                        )}
                        <span className="block font-mono text-xs text-slate-500">{customerNo(loan.customer_no)}</span>
                      </TD>
                      <TD mono>
                        <Link href={`/dashboard/loans/${loan.id}`} className="text-navy-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
                          {loan.ticket_number}
                        </Link>
                        {loan.category && (
                          <span className="block font-sans text-xs text-slate-500">
                            {categoryLabel(loan.category, loan.category_other)}, {loan.karat}K
                          </span>
                        )}
                      </TD>
                      <TD align="right" className="text-slate-600">
                        {formatPeso(loan.principal_amount)}
                      </TD>
                      <TD align="right">{formatPeso(loan.principal_balance)}</TD>
                      <TD align="right">{formatPeso(loan.interest_now)}</TD>
                      <TD align="right" className="font-semibold text-navy-900">
                        {formatPeso(loan.owed)}
                      </TD>
                      <TD className="whitespace-nowrap">{formatDate(loan.maturity_date)}</TD>
                      <TD>
                        {/* the loan's state and, separately, its payment situation today (Loans page badges):
                            a Renewed loan can also be Overdue */}
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
                {/* OL6: the totals are for ALL matching loans, not only this page (added up by the database) */}
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                  <TD colSpan={2}>
                    Total · {r.total.toLocaleString("en-PH")} {filtered ? `matching loan${r.total === 1 ? "" : "s"}` : `open loan${r.total === 1 ? "" : "s"}`}
                    {filtered && <span className="block text-xs font-normal text-slate-600">{scope}</span>}
                  </TD>
                  <TD align="right">{formatPeso(r.totals.principal)}</TD>
                  <TD align="right">{formatPeso(r.totals.balance)}</TD>
                  <TD align="right">{formatPeso(r.totals.interest)}</TD>
                  <TD align="right" className="text-navy-900">
                    {formatPeso(r.totals.owed)}
                  </TD>
                  <TD colSpan={2} />
                  <td className="print:hidden" />
                </tr>
              </TBody>
            </Table>
            <ReportPagination page={r.page} pageSize={r.size} total={r.total} params={{ ...current, all: all ? "1" : undefined }} basePath={BASE} label="Outstanding loans pages" />
            <ShowAllLink all={all} total={r.total} href={reportHref(BASE, current, { all: all ? undefined : "1" })} pageSize={PAGE_SIZE} />
          </>
        ) : (
          <EmptyState
            title={filtered ? "No loan matches these filters" : "No open loans."}
            description={filtered ? "Try All open loans, a wider due date range, or Clear filters." : undefined}
          />
        )}
      </Card>
    </div>
  );
}
