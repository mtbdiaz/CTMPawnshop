import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/format";
import { customerNo } from "@/lib/ref-numbers";
import { FLAG_STATUS, shortReason, type FlagPage, type FlagRow } from "@/lib/compliance/flags"; // the Suspicious activity page's words
import { ReportHeader } from "@/components/report-header";
import { Badge, Card, EmptyState, SectionTitle, Table, TBody, TD, TH, THead, TR, ActionsCell, ViewButton, buttonClasses, cx, pageParam } from "@/components/ui";
import { reportData } from "@/lib/reports/report-utils";
import { PrintScope, ShowAllLink, reportHref } from "../report-parts";
import { ReportPagination } from "../report-pagination";

export const metadata = { title: "Compliance / AML report" };

const BASE = "/dashboard/reports/compliance";
const PAGE_SIZE = 10; // CR4 (Nov 14): 10 per page like the other reports
const ALL_SIZE = 100; // the most suspicious_flag_page sends in one request ("Show all on one page")

// report_compliance_records() (migration 0071): no ID number or ID detail is in here
type ComplianceRecords = {
  counts: { aml: number; blacklisted: number };
  aml: {
    customer_id: string;
    customer_no: number;
    full_name: string;
    aml_checked_at: string | null;
    aml_notes: string | null;
    is_blacklisted: boolean;
    flags_needing_review: number;
    flagged_saved_at: string | null; // from the audit trail: when the record that set "flagged" was saved
    flagged_saved_by: string | null;
  }[];
  blacklisted: {
    customer_id: string;
    customer_no: number;
    full_name: string;
    blacklist_reason: string | null;
    blacklisted_at: string | null; // from the audit trail: when is_blacklisted was set to true
    blacklisted_by: string | null;
    flag_decided_at: string | null; // the newest flag decided as Blacklisted for this customer, if any
    flag_decided_by: string | null;
    flag_reason: string | null;
    flag_note: string | null;
    open_loans: number;
  }[];
};

// RP7 (Nov 12): Compliance / AML (Admin only; since migration 0063 the database also lets only Admins read flags).
// CR1–CR8 (Nov 14, after the Compliance / AML review):
// - summary first: AML screening matches, blacklisted customers, flags needing attention (open + investigating),
//   decided flags (dismissed + blacklisted); they count different things and are never added together;
// - flags needing attention come first, with search and a status filter, 10 per page, read from the same database
//   function as Suspicious activity (suspicious_flag_page), and a Review link to Suspicious activity;
// - AML screening matches show who saved the match and when (audit trail), the note exactly as written, and say
//   plainly that no separate outcome, reviewer or evidence is recorded (nothing is inferred from the note);
// - blacklisted customers show the real blacklist date and the Admin who set it (audit trail, migration 0071) instead
//   of "Record last changed", plus the flag decision that goes with it, if any, and their open loans;
// - decided flags (history) at the bottom with who decided and when, and the decision note; nothing is hidden;
// - printouts state the scope, show a Limited print view note for part of a list, and say this is not a certification.
// Read only: nobody is blacklisted, cleared, dismissed or changed from here.
export default async function ComplianceReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const status = sp.status === "open" || sp.status === "investigating" ? sp.status : "";
  const all = sp.all === "1"; // everything on one page (for printing)

  const supabase = await createClient();
  const size = all ? ALL_SIZE : PAGE_SIZE;
  // the same function (and Admin check) as the Suspicious activity page
  const attentionPage = (p: number) =>
    supabase.rpc("suspicious_flag_page", { p_view: "open", p_q: q || undefined, p_status: status || undefined, p_page: p, p_size: size });
  const decidedPage = (p: number) => supabase.rpc("suspicious_flag_page", { p_view: "resolved", p_page: p, p_size: size });
  const [recRes, attentionRes, decidedRes] = await Promise.all([
    supabase.rpc("report_compliance_records"),
    attentionPage(pageParam(sp.page)),
    decidedPage(pageParam(sp.hpage)),
  ]);
  const rec = reportData<ComplianceRecords>(recRes);
  let attention = reportData<FlagPage>(attentionRes);
  let decided = reportData<FlagPage>(decidedRes);
  // CR11 (Nov 14): a page number past the end (an old link after a flag was decided, or one typed in) now shows the
  // last page, like the other reports. Before: an empty table and "Showing 11–10 of 10"
  const lastPage = (f: FlagPage) => Math.max(1, Math.ceil(f.total / f.size));
  if (!attention.rows.length && attention.page > lastPage(attention)) attention = reportData<FlagPage>(await attentionPage(lastPage(attention)));
  if (!decided.rows.length && decided.page > lastPage(decided)) decided = reportData<FlagPage>(await decidedPage(lastPage(decided)));
  const c = attention.counts; // counts of every flag (not archived), before the search
  const decidedCount = (s: FlagRow["status"]) => decided.rows.length === decided.total ? decided.rows.filter((f) => f.status === s).length : null;
  const dismissedN = decidedCount("dismissed");
  const blacklistedN = decidedCount("blacklisted");

  const current = { q: q || undefined, status: status || undefined, hpage: sp.hpage, all: all ? "1" : undefined };
  const filtered = Boolean(q || status);
  const scope = [status ? FLAG_STATUS[status].label : "Open and Investigating", q ? `search "${q}"` : ""].filter(Boolean).join(" · ");
  const reviewHref = (f: FlagRow, resolved = false) =>
    `/dashboard/compliance?${new URLSearchParams({ ...(resolved ? { view: "resolved" } : {}), q: f.customer_no ? customerNo(f.customer_no) : (f.customer_name ?? "") }).toString()}`;
  const field = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20";
  const today = new Date().toISOString();

  return (
    <div className="space-y-6">
      <ReportHeader
        title="Compliance / AML"
        description="AML screening matches, blacklisted customers and suspicious-activity flags, for an Admin's review. Read only: flag decisions are made on Suspicious activity."
        subtitle={`As of ${formatDate(today)} · ${c.needs_review} flag${c.needs_review === 1 ? "" : "s"} need${c.needs_review === 1 ? "s" : ""} attention`}
      />

      {/* CR1: the four numbers first. They count different things (a customer can be in more than one), so they
          are never added together */}
      <section aria-labelledby="cr-summary" className="break-inside-avoid">
        <h2 id="cr-summary" className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Summary · as of {formatDate(today)}
        </h2>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className={cx("rounded-md border border-l-4 border-slate-200 bg-white px-3 py-2", c.needs_review ? "border-l-amber-400" : "border-l-slate-300")}>
            <dt className="text-xs font-medium text-slate-600">Flags needing attention</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{c.needs_review}</dd>
            <dd className="text-xs text-slate-500">
              {c.open} open · {c.investigating} investigating
            </dd>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
            <dt className="text-xs font-medium text-slate-600">Decided flags</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{c.resolved}</dd>
            <dd className="text-xs text-slate-500">{dismissedN !== null && blacklistedN !== null ? `${dismissedN} dismissed · ${blacklistedN} blacklisted` : "Dismissed or Blacklisted"}</dd>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
            <dt className="text-xs font-medium text-slate-600">Blacklisted customers</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{rec.counts.blacklisted}</dd>
            <dd className="text-xs text-slate-500">New loans and appraisals refused</dd>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
            <dt className="text-xs font-medium text-slate-600">AML screening matches recorded</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{rec.counts.aml}</dd>
            <dd className="text-xs text-slate-500">A recorded match, not a finding by itself</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-slate-600">
          These count different things and can overlap (one customer can have a flag, a screening match and a blacklist), so they are not added together.
          A flag is a reason to look into something, not proof of wrongdoing.
        </p>
      </section>

      {/* CR2: what an Admin has to act on, first */}
      <section>
        <SectionTitle
          description={
            <>
              Open and Investigating flags, newest first.{" "}
              <Link href="/dashboard/compliance" className="font-medium text-navy-700 hover:underline print:hidden">
                Decide them on Suspicious activity
              </Link>
            </>
          }
        >
          Suspicious activity needing attention
        </SectionTitle>
        <Card padded={false}>
          <form action={BASE} className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4 print:hidden">
            {current.hpage && <input type="hidden" name="hpage" value={current.hpage} />}
            <div className="min-w-[14rem] flex-[2_1_16rem]">
              <label htmlFor="q" className="block text-xs font-medium text-slate-600">
                Search
              </label>
              <input id="q" name="q" type="search" defaultValue={q} placeholder="Customer, C-number, ticket or reason" className={field} />
            </div>
            <div className="min-w-[11rem] flex-[1_1_11rem]">
              <label htmlFor="status" className="block text-xs font-medium text-slate-600">
                Status
              </label>
              <select id="status" name="status" defaultValue={status} className={field}>
                <option value="">Open and Investigating ({c.needs_review})</option>
                <option value="open">Open ({c.open})</option>
                <option value="investigating">Investigating ({c.investigating})</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              {filtered && (
                <Link href={reportHref(BASE, current, { q: undefined, status: undefined })} className={buttonClasses("ghost")}>
                  Clear filters
                </Link>
              )}
              <button type="submit" className={buttonClasses("primary")}>
                Apply filters
              </button>
            </div>
          </form>
          <p className="border-b border-slate-200 px-4 py-2 text-sm text-slate-600" aria-live="polite">
            <span className="font-medium text-slate-900">{attention.total}</span> flag{attention.total === 1 ? "" : "s"} · {scope}
          </p>
          {attention.total ? (
            <>
              <PrintScope page={attention.page} size={attention.size} total={attention.total} shown={attention.rows.length} all={all} totalRow={false} advice="To print every flag, use “Show all on one page (for printing)”." />
              <FlagTable rows={attention.rows} ruleReason={attention.rule_reason} reviewHref={(f) => reviewHref(f)} mode="attention" />
              <ReportPagination page={attention.page} pageSize={attention.size} total={attention.total} params={current} basePath={BASE} label="Flags needing attention pages" />
            </>
          ) : (
            <EmptyState title={filtered ? "No flag matches these filters" : "No flags need attention"} description={filtered ? "Try another search, or Clear filters." : undefined} />
          )}
        </Card>
      </section>

      {/* CR3: AML screening matches, shown exactly as recorded */}
      <section className="break-inside-avoid">
        <SectionTitle description="A name match saved by the AML check when the customer was registered. PawnTrack has no separate field for the review outcome, the reviewer or the evidence, so the note is shown exactly as written.">
          AML screening matches
        </SectionTitle>
        <Card padded={false}>
          {rec.aml.length ? (
            <Table minWidth="760px" className="print:[&_tr]:break-inside-avoid [&_td]:px-2 [&_th]:px-2">
              <THead>
                <TH>Customer</TH>
                <TH>Match saved</TH>
                <TH>Recorded note</TH>
                <TH>Outcome</TH>
                <TH>Now</TH>
              </THead>
              <TBody>
                {rec.aml.map((a) => (
                  <TR key={a.customer_id}>
                    <TD>
                      <CustomerLink id={a.customer_id} name={a.full_name} no={a.customer_no} />
                    </TD>
                    <TD className="whitespace-nowrap">
                      {a.aml_checked_at ? formatDate(a.aml_checked_at) : "Not recorded"}
                      <span className="block text-xs text-slate-500">{a.flagged_saved_by ? `by ${a.flagged_saved_by}` : "saved by: not in the audit trail"}</span>
                    </TD>
                    <TD className="max-w-md">{a.aml_notes || <span className="text-slate-500">No note</span>}</TD>
                    {/* CR3: never read "cleared" out of the note: there is no outcome field */}
                    <TD className="text-slate-600">Not separately recorded</TD>
                    <TD>
                      <span className="flex flex-wrap gap-1">
                        {a.is_blacklisted ? <Badge tone="danger" icon>Blacklisted</Badge> : <Badge tone="neutral">Not blacklisted</Badge>}
                        {a.flags_needing_review > 0 && <Badge tone="warning">{a.flags_needing_review} flag{a.flags_needing_review === 1 ? "" : "s"} need attention</Badge>}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState title="No AML screening matches" />
          )}
        </Card>
      </section>

      {/* CR4: blacklisted customers with the real blacklist date and Admin (audit trail), not "record last changed" */}
      <section className="break-inside-avoid">
        <SectionTitle description="New loans and new appraisals are refused for these customers; loans they already have stay as they are. A blacklist is set or removed on the customer's page or on Suspicious activity, never here. The blacklist and a flag decided as Blacklisted are separate records; the report shows each as recorded and does not link them.">
          Blacklisted customers
        </SectionTitle>
        <Card padded={false}>
          {rec.blacklisted.length ? (
            <Table minWidth="760px" className="print:[&_tr]:break-inside-avoid [&_td]:px-2 [&_th]:px-2">
              <THead>
                <TH>Customer</TH>
                <TH>Recorded reason</TH>
                <TH>Blacklisted</TH>
                {/* CR10 (Nov 14): "Blacklisted flag on record" (was "Related flag decision"): the audit trail shows the
                    blacklist and the flag decision as separate entries on different days, with different reasons, and
                    nothing in the records links them, so the report doesn't say one caused the other */}
                <TH>Blacklisted flag on record</TH>
                <TH align="right">Open loans</TH>
              </THead>
              <TBody>
                {rec.blacklisted.map((b) => (
                  <TR key={b.customer_id}>
                    <TD>
                      <CustomerLink id={b.customer_id} name={b.full_name} no={b.customer_no} />
                    </TD>
                    <TD className="max-w-xs">{b.blacklist_reason || <span className="text-slate-500">No reason recorded</span>}</TD>
                    <TD className="whitespace-nowrap">
                      {b.blacklisted_at ? (
                        <>
                          <span title={formatDateTime(b.blacklisted_at)}>{formatDate(b.blacklisted_at)}</span>
                          <span className="block text-xs text-slate-500">{b.blacklisted_by ? `by ${b.blacklisted_by}` : "by: not recorded"}</span>
                        </>
                      ) : (
                        <span className="text-slate-500">Not in the audit trail</span>
                      )}
                    </TD>
                    <TD className="max-w-xs">
                      {b.flag_decided_at ? (
                        <>
                          <span className="whitespace-nowrap">
                            Flag decided {formatDate(b.flag_decided_at)}
                            {b.flag_decided_by ? ` by ${b.flag_decided_by}` : ""}
                          </span>
                          <span className="block text-xs text-slate-500">Flag reason: {b.flag_reason}</span>
                          {b.flag_note && <span className="block text-xs text-slate-500">Note: {b.flag_note}</span>}
                        </>
                      ) : (
                        <span className="text-slate-500">No flag decided as Blacklisted</span>
                      )}
                    </TD>
                    <TD align="right" className="tabular-nums">
                      {b.open_loans}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState title="No blacklisted customers" />
          )}
        </Card>
      </section>

      {/* CR6: the history stays complete and printable */}
      <section>
        <SectionTitle description="Dismissed and Blacklisted flags, newest decision first, with who decided and the note they wrote.">Decided flags</SectionTitle>
        <Card padded={false}>
          {decided.total ? (
            <>
              <PrintScope page={decided.page} size={decided.size} total={decided.total} shown={decided.rows.length} all={all} totalRow={false} advice="To print every flag, use “Show all on one page (for printing)”." />
              <FlagTable rows={decided.rows} ruleReason={decided.rule_reason} reviewHref={(f) => reviewHref(f, true)} mode="decided" />
              <ReportPagination page={decided.page} pageSize={decided.size} total={decided.total} params={{ q: current.q, status: current.status, page: sp.page, all: current.all }} basePath={BASE} label="Decided flags pages" pageKey="hpage" />
            </>
          ) : (
            <EmptyState title="No decided flags yet" />
          )}
        </Card>
        <ShowAllLink all={all} total={Math.max(attention.total, decided.total)} href={reportHref(BASE, { q: current.q, status: current.status }, { all: all ? undefined : "1" })} pageSize={PAGE_SIZE} />
      </section>

      {/* CR8: printed too, so the printout is never read as a certification */}
      <p className="text-xs text-slate-500">
        A system-generated report from the records saved in PawnTrack. It is not an independent regulatory certification and does not by itself show
        that the shop meets its AML obligations.
      </p>
    </div>
  );
}

function CustomerLink({ id, name, no }: { id: string | null; name: string | null; no: number | null }) {
  return (
    <>
      {id ? (
        <Link href={`/dashboard/customers/${id}`} className="font-medium text-slate-900 hover:text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
          {name ?? ""}
        </Link>
      ) : (
        <span className="font-medium text-slate-900">{name ?? ""}</span>
      )}
      {no ? <span className="block font-mono text-xs text-slate-500">{customerNo(no)}</span> : null}
    </>
  );
}

// CR5: one table for both flag lists. Needing attention: status (and, for Investigating, who started it and when);
// decided: the decision, who made it, when, and the note. The reason is shown short with the full text under it.
function FlagTable({ rows, ruleReason, reviewHref, mode }: { rows: FlagRow[]; ruleReason: string; reviewHref: (f: FlagRow) => string; mode: "attention" | "decided" }) {
  return (
    <Table minWidth="760px" className="print:[&_tr]:break-inside-avoid [&_td]:px-2 [&_th]:px-2">
      <THead>
        <TH>Customer</TH>
        <TH>Flagged</TH>
        <TH>Recorded reason</TH>
        <TH>{mode === "attention" ? "Status" : "Decision"}</TH>
        {/* RP13: "relative" keeps the hidden "Actions" label inside the table's scroll box */}
        <TH className="relative print:hidden">
          <span className="sr-only">Actions</span>
        </TH>
      </THead>
      <TBody>
        {rows.map((f) => {
          const st = FLAG_STATUS[f.status];
          const short = shortReason(f.reason, ruleReason);
          return (
            <TR key={f.id}>
              <TD>
                <CustomerLink id={f.customer_id} name={f.customer_name} no={f.customer_no} />
              </TD>
              <TD className="whitespace-nowrap">
                <span title={formatDateTime(f.created_at)}>{formatDate(f.created_at)}</span>
              </TD>
              <TD className="max-w-md">
                {/* CR9 (Nov 14): the short reason, and the full reason exactly as recorded behind "Full reason" (a
                    <details>: opens with a click, a tap, or Enter / Space on the keyboard). On paper the full reason is
                    always printed. Before: the full reason was only in a hover tooltip, which touchscreens can't open */}
                <span className="font-medium text-slate-900">{short}</span>
                {short !== f.reason.trim() && (
                  <>
                    <details className="group mt-0.5 text-xs text-slate-600 print:hidden">
                      <summary className="w-fit cursor-pointer rounded font-medium text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
                        Full reason
                      </summary>
                      <p className="mt-1 text-slate-700">{f.reason}</p>
                    </details>
                    <span className="hidden text-xs text-slate-500 print:block">{f.reason}</span>
                  </>
                )}
              </TD>
              <TD className="min-w-[10rem]">
                <Badge tone={st.tone} icon={f.status === "blacklisted"}>
                  {st.label}
                </Badge>
                {f.status === "investigating" ? (
                  // "Mark investigating" saves who and when (resolved_by / resolved_at), as on Suspicious activity
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {f.resolved_at ? `Review started ${formatDate(f.resolved_at)}${f.resolved_by_name ? ` by ${f.resolved_by_name}` : ""}` : "Under review; start date not recorded"}
                  </span>
                ) : f.status === "open" ? (
                  <span className="mt-0.5 block text-xs text-slate-500">Waiting for an Admin&apos;s review</span>
                ) : (
                  <>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {f.resolved_at ? `${formatDate(f.resolved_at)}${f.resolved_by_name ? ` by ${f.resolved_by_name}` : ""}` : "Decision date not recorded"}
                    </span>
                    {f.resolution_notes && <span className="block text-xs text-slate-500">Note: {f.resolution_notes}</span>}
                  </>
                )}
              </TD>
              <ActionsCell>
                <ViewButton href={reviewHref(f)}>{mode === "attention" ? "Review" : "View"}</ViewButton>
              </ActionsCell>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
