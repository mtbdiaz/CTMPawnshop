import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPeso } from "@/lib/format";
import { ReportHeader } from "@/components/report-header";
import { Badge, Card, EmptyState, StatusBadge, Table, TBody, TD, TH, THead, TR, ActionsCell, ViewButton, buttonClasses, cx, pageParam, type BadgeTone } from "@/components/ui";
import { stateBadge } from "@/lib/loans/display";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { customerNo } from "@/lib/ref-numbers";
import { OVERDUE_SORTS, OVERDUE_STAGES, PRINT_LIMIT, dateParam, reportData, type OverdueSort, type OverdueStage, type ReportLoans } from "@/lib/reports/report-utils";
import { PrintScope, ShowAllLink, reportHref } from "../report-parts";
import { ReportPagination } from "../report-pagination"; // OV7: the same paging as Outstanding loans and the Audit Trail

export const metadata = { title: "Overdue loans report" };

const BASE = "/dashboard/reports/overdue";
const PAGE_SIZE = 10; // OV7 (Nov 13): 10 per page like Outstanding loans (was 50)
const STAGES = Object.keys(OVERDUE_STAGES) as OverdueStage[];

// OV4 (Nov 13): one colour step per stage, always with the words: amber = in grace, light red = past grace and
// waiting for the default check, solid red with the alert icon = Defaulted. Before: In grace and Past grace were
// both amber, and every row was coloured too.
const STAGE_TONE: Record<OverdueStage, BadgeTone> = { in_grace: "warning", past_grace: "alert", defaulted: "danger" };
// the small coloured bar on each stage box (grey when the stage holds no loans)
const STAGE_BAR: Record<OverdueStage, string> = { in_grace: "border-l-amber-400", past_grace: "border-l-red-300", defaulted: "border-l-red-700" };

// RP4 (Nov 12): Overdue loans = the Loans page's rule (past due AND still owes money) plus Defaulted loans that
// still owe; each loan is In grace, Past grace (the default check will mark it Defaulted) or Defaulted. Worked out
// by the database (report_loans, migrations 0066 + 0069). This report only reads: it never runs the default check
// and never changes a loan.
// OV1–OV8 (Nov 13, after the Overdue loans review, same patterns as the approved Outstanding loans report):
// - a compact summary of ALL overdue loans (count, total owed now, and each stage with its count and amount), and a
//   line explaining why this report has more loans than Outstanding loans' Overdue figure (Defaulted loans);
// - one filter row: search, stage, due date from / to, sort (default: most days overdue), Clear and Apply;
// - the table: no red or amber row colour (the stage badge says it), the customer links to their page (no phone
//   number on a printable report), the ticket links to the loan with the item under it, grace end under the due
//   date, Days past due and Owed now right-aligned and in bold; the totals row says what it adds up;
// - 10 per page with page numbers and Go to page; printouts state the scope and keep each loan on one line;
// - "What do the overdue stages mean?" at the bottom.
export default async function OverdueLoansReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const stage = (sp.stage && sp.stage in OVERDUE_STAGES ? sp.stage : "") as OverdueStage | "";
  const sort = (sp.sort && sp.sort in OVERDUE_SORTS ? sp.sort : "due") as OverdueSort;
  const dueFrom = dateParam(sp.due_from);
  const dueTo = dateParam(sp.due_to);
  const badRange = Boolean(dueFrom && dueTo && dueFrom > dueTo); // explained below and not sent to the database
  const all = sp.all === "1"; // up to 1,000 rows on one page (for printing)

  const supabase = await createClient();
  const r = reportData<ReportLoans>(
    await supabase.rpc("report_loans", {
      p_report: "overdue",
      p_q: q || undefined,
      p_filter: stage || undefined,
      p_due_from: badRange ? undefined : dueFrom,
      p_due_to: badRange ? undefined : dueTo,
      p_sort: sort === "due" ? undefined : sort,
      p_page: pageParam(sp.page),
      p_size: all ? PRINT_LIMIT : PAGE_SIZE,
    }),
  );
  const today = r.today; // the database's Manila date, so the page and the numbers agree
  const count = (k: OverdueStage) => Number(r.counts?.[k] ?? 0);
  const sum = (k: OverdueStage) => Number(r.sums?.[k] ?? 0);
  const openOverdue = count("in_grace") + count("past_grace"); // what Outstanding loans calls Overdue

  const current = { q: q || undefined, stage: stage || undefined, sort: sort === "due" ? undefined : sort, due_from: badRange ? undefined : dueFrom, due_to: badRange ? undefined : dueTo };
  const filtered = Boolean(q || stage || (!badRange && (dueFrom || dueTo)));
  // the scope in words, used by the totals row, the list header and the printout
  const scope = [
    stage ? OVERDUE_STAGES[stage] : "All overdue loans",
    q ? `search "${q}"` : "",
    !badRange && (dueFrom || dueTo) ? `due ${dueFrom ? formatDate(dueFrom) : "any time"} – ${dueTo ? formatDate(dueTo) : "any time"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const field = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20";

  return (
    <div>
      <ReportHeader
        title="Overdue loans"
        description="Loans past their due date that still owe money, including defaulted loans. Fully paid loans awaiting release are excluded."
        subtitle={`As of ${formatDate(today)} · ${scope}${sort !== "due" ? ` · sorted by ${OVERDUE_SORTS[sort].toLowerCase()}` : ""}`}
      />

      {/* OV3: a compact overview of every overdue loan (not only the list below), from the database */}
      <section aria-labelledby="ov-summary" className="mb-4 break-inside-avoid">
        <h2 id="ov-summary" className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          All overdue loans · as of {formatDate(today)}
        </h2>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
            <dt className="text-xs font-medium text-slate-600">Overdue loans</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">{r.all_count.toLocaleString("en-PH")}</dd>
          </div>
          <div className="rounded-md border border-navy-200 bg-navy-50 px-3 py-2">
            <dt className="text-xs font-medium text-slate-600">Total owed now</dt>
            <dd className="mt-0.5 whitespace-nowrap text-lg font-semibold tabular-nums text-navy-900">{formatPeso(r.all_owed)}</dd>
          </div>
          {STAGES.map((k) => (
            <div key={k} className={cx("rounded-md border border-l-4 border-slate-200 bg-white px-3 py-2", count(k) ? STAGE_BAR[k] : "border-l-slate-300")}>
              <dt className="text-xs font-medium text-slate-600">{OVERDUE_STAGES[k]}</dt>
              <dd className={cx("mt-0.5 text-base font-semibold tabular-nums", count(k) ? "text-slate-900" : "text-slate-500")}>
                {count(k).toLocaleString("en-PH")}
                <span className="ml-2 whitespace-nowrap text-sm font-normal text-slate-600">{formatPeso(sum(k))}</span>
              </dd>
            </div>
          ))}
        </dl>
        {/* OV1: why this report has more loans than the Overdue figure on Outstanding loans */}
        <p className="mt-2 text-xs text-slate-600">
          Includes {count("defaulted").toLocaleString("en-PH")} Defaulted loan{count("defaulted") === 1 ? "" : "s"} that still owe money. Outstanding loans
          lists only open loans, so its Overdue figure ({openOverdue.toLocaleString("en-PH")}) is In grace + Past grace, without the Defaulted ones.
        </p>
      </section>

      <Card padded={false}>
        {/* OV5: one filter row like Outstanding loans; everything is in the address, so paging and Back keep it */}
        <form action={BASE} className="space-y-3 border-b border-slate-200 p-4 print:hidden">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,2fr)_minmax(11rem,1.3fr)_repeat(2,minmax(9rem,1fr))_minmax(12rem,1.3fr)]">
            <div className="sm:col-span-2 xl:col-span-1">
              <label htmlFor="q" className="block text-xs font-medium text-slate-600">
                Search
              </label>
              <input id="q" name="q" type="search" defaultValue={q} placeholder="Customer, C-number or ticket" className={field} />
            </div>
            <div>
              <label htmlFor="stage" className="block text-xs font-medium text-slate-600">
                Stage
              </label>
              <select id="stage" name="stage" defaultValue={stage} className={field}>
                <option value="">All overdue loans ({r.all_count})</option>
                {STAGES.map((k) => (
                  <option key={k} value={k}>
                    {OVERDUE_STAGES[k]} ({count(k)})
                  </option>
                ))}
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
                {(Object.keys(OVERDUE_SORTS) as OverdueSort[]).map((k) => (
                  <option key={k} value={k}>
                    {OVERDUE_SORTS[k]}
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
        {/* what the list (and its totals row) covers */}
        <p className="border-b border-slate-200 px-4 py-2 text-sm text-slate-600 print:hidden" aria-live="polite">
          <span className="font-medium text-slate-900">{r.total.toLocaleString("en-PH")}</span> loan{r.total === 1 ? "" : "s"} · {scope}
          {sort !== "due" ? ` · ${OVERDUE_SORTS[sort]}` : ""}
        </p>

        {r.total ? (
          <>
            <PrintScope page={r.page} size={r.size} total={r.total} shown={r.rows.length} all={all} />
            {/* on paper a loan's row is never split across two pages; 8px side padding in the cells (was 12px) like
                Outstanding loans, so the whole table fits a 1366 screen even at 125% and 150% zoom */}
            <Table minWidth="800px" className="print:[&_tr]:break-inside-avoid [&_td]:px-2 [&_th]:px-2">
              <THead>
                <TH>Customer</TH>
                <TH>Ticket and item</TH>
                <TH>Due</TH>
                <TH align="right">Days past due</TH>
                <TH align="right">Owed now</TH>
                <TH>Stage</TH>
                {/* RP13: "relative" keeps the hidden "Actions" label inside the table's scroll box (no sideways page scroll) */}
                <TH className="relative print:hidden">
                  <span className="sr-only">Actions</span>
                </TH>
              </THead>
              <TBody>
                {r.rows.map((loan) => {
                  const st = loan.stage as OverdueStage; // every row of this report has a stage
                  return (
                    // OV6: no row colour any more (was red for every Defaulted row, amber for In grace): the badge says it
                    <TR key={loan.id}>
                      <TD>
                        {/* OV6: the name opens the customer; the C-number underneath (no phone number on a printable report) */}
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
                      <TD className="whitespace-nowrap">
                        {formatDate(loan.maturity_date)}
                        {/* OV6: the grace end from the database (due date + the loan's grace days); not shown once Defaulted */}
                        {st !== "defaulted" && (
                          <span className="block text-xs text-slate-500">
                            {st === "in_grace" ? "Grace ends" : "Grace ended"} {formatDate(loan.grace_end)}
                          </span>
                        )}
                      </TD>
                      <TD align="right" className="font-semibold tabular-nums">
                        {loan.days_late}
                      </TD>
                      <TD align="right" className="font-semibold text-navy-900">
                        {formatPeso(loan.owed)}
                      </TD>
                      <TD>
                        {/* the stage and, for a Renewed or Reinstated loan, its state (as before) */}
                        <span className="flex flex-wrap gap-1">
                          <Badge tone={STAGE_TONE[st]} icon={st === "defaulted"}>
                            {OVERDUE_STAGES[st]}
                          </Badge>
                          {st !== "defaulted" && loan.status !== "active" && <StatusBadge status={loan.status} label={stateBadge(loan.status).label} />}
                        </span>
                      </TD>
                      <ActionsCell>
                        <ViewButton href={`/dashboard/loans/${loan.id}`}>View loan</ViewButton>
                      </ActionsCell>
                    </TR>
                  );
                })}
                {/* the total is for ALL matching loans, not only this page (added up by the database) */}
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                  <TD colSpan={4}>
                    Total · {r.total.toLocaleString("en-PH")} {filtered ? `matching loan${r.total === 1 ? "" : "s"}` : `overdue loan${r.total === 1 ? "" : "s"}`}
                    {filtered && <span className="block text-xs font-normal text-slate-600">{scope}</span>}
                  </TD>
                  <TD align="right" className="text-navy-900">
                    {formatPeso(r.totals.owed)}
                  </TD>
                  <TD />
                  <td className="print:hidden" />
                </tr>
              </TBody>
            </Table>
            <ReportPagination page={r.page} pageSize={r.size} total={r.total} params={{ ...current, all: all ? "1" : undefined }} basePath={BASE} label="Overdue loans pages" />
            <ShowAllLink all={all} total={r.total} href={reportHref(BASE, current, { all: all ? undefined : "1" })} pageSize={PAGE_SIZE} />
          </>
        ) : (
          <EmptyState
            title={filtered ? "No loan matches these filters" : "No overdue loans."}
            description={filtered ? "Try All overdue loans, a wider due date range, or Clear filters." : undefined}
          />
        )}
        {r.paid_past_due > 0 && (
          <p className="border-t border-slate-200 px-4 py-2.5 text-xs text-slate-600">
            Not listed: {r.paid_past_due} loan{r.paid_past_due === 1 ? " is" : "s are"} past the due date but fully paid, waiting for the item to be released
            {/* the link is for the screen only; on paper the sentence ends without a stray space */}
            <span className="print:hidden">
              {" "}
              (see{" "}
              <Link href="/dashboard/reports/outstanding?show=paid" className="font-medium text-navy-700 hover:underline">
                Outstanding loans → Ready to release
              </Link>
              )
            </span>
            .
          </p>
        )}
      </Card>

      {/* OV8: the stages in plain words, closed until asked for (not printed) */}
      <details className="mt-4 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 print:hidden">
        <summary className="cursor-pointer font-medium text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
          What do the overdue stages mean?
        </summary>
        <dl className="mt-3 space-y-3">
          <div>
            <dt>
              <Badge tone="warning">{OVERDUE_STAGES.in_grace}</Badge>
            </dt>
            <dd className="mt-1">The due date has passed and the loan still owes money, but its grace days have not run out yet. The customer can still pay or renew.</dd>
          </div>
          <div>
            <dt>
              <Badge tone="alert">{OVERDUE_STAGES.past_grace}</Badge>
            </dt>
            <dd className="mt-1">
              The grace days have run out and the loan still owes money, but it is not marked Defaulted yet. The nightly default check (12:05 AM) marks
              it Defaulted; opening this report never does.
            </dd>
          </div>
          <div>
            <dt>
              <Badge tone="danger" icon>
                {OVERDUE_STAGES.defaulted}
              </Badge>
            </dt>
            <dd className="mt-1">The loan is already recorded as Defaulted and still owes money. It stays on this report while it is Defaulted and still owes money.</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-slate-600">
          Not on this report: loans not yet due, and loans that are fully paid (even past the due date) while they wait for the item to be released.
        </p>
      </details>
    </div>
  );
}
