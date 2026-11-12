import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/format";
import { customerNo } from "@/lib/ref-numbers"; // C-0012
import { FLAG_STATUS, RULE_MIN_LOANS, RULE_WINDOW_HOURS, flagFilters, shortReason, type FlagPage, type FlagRow } from "@/lib/compliance/flags"; // SA6
import { Badge, Card, EmptyState, PageHeader, Pagination, SearchBar, Table, TBody, TD, TH, THead, TR, pageParam } from "@/components/ui";
import { ViewTabs, ViewToolbar } from "@/components/view-tabs"; // D2: the shared tab row and the row under it ("Viewing")
import { NavSelect } from "@/components/nav-select"; // the same dropdown as Inventory's Category
import { ReviewFlagButton, ViewDecisionButton } from "./review-flag";

export const metadata = { title: "Suspicious activity" };

const PAGE_SIZE = 10; // rows per page, same as the other lists
const BASE = "/dashboard/compliance";

// PB-32 + SA6 (Nov 12, migration 0060).
// Before: each row held the whole decision form (a note box and three buttons), the reason column showed a
// "loans in 24 hours" line on every flag (also where it meant nothing), Resolved showed only the newest 100, and
// there was no search.
// Now: a compact queue (Customer, Flag reason, Flagged on, Status, Action), search and an Open / Investigating
// filter that run in the database before the page is cut, 10 per page, and one "Review flag" popup with the
// evidence first and the decisions after. A decision is saved in one step by the database (review_suspicious_flag).
export default async function CompliancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const f = flagFilters(sp); // the tab, search and filter from the address, cleaned
  const page = pageParam(sp.page);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("suspicious_flag_page", {
    p_view: f.view,
    p_q: f.q || undefined,
    p_status: f.status || undefined,
    p_page: page,
    p_size: PAGE_SIZE,
  });
  if (error) throw error;
  const res = data as unknown as FlagPage;
  const c = res.counts;

  // the address of this list with one thing changed (the search and filter stay; the page goes back to 1)
  const href = (change: Partial<{ view: string; q: string; status: string }>) => {
    const next = { view: f.view === "resolved" ? "resolved" : "", q: f.q, status: f.status, ...change };
    const p = new URLSearchParams();
    if (next.view === "resolved") p.set("view", "resolved");
    if (next.q) p.set("q", next.q);
    if (next.status && next.view !== "resolved") p.set("status", next.status);
    const s = p.toString();
    return s ? `${BASE}?${s}` : BASE;
  };
  const filtered = Boolean(f.q || f.status);
  const reviewing = f.view === "open";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Suspicious activity"
        description="Review flagged customer activity and record a decision."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Suspicious activity" }]}
      />

      <Card padded={false}>
        <ViewTabs
          label="Flag views"
          current={f.view}
          tabs={[
            { label: "Needs review", value: "open", href: href({ view: "", status: "" }), count: c.needs_review, tone: "warning" },
            { label: "Resolved", value: "resolved", href: href({ view: "resolved", status: "" }), count: c.resolved },
          ]}
        />

        {/* search on the left, and on Needs review a Status dropdown (same as Inventory's Category). Both run in the database,
            before the page is cut. On the right "Viewing: Needs review", or "N matches in Needs review" while searching */}
        <ViewToolbar viewing={reviewing ? "Needs review" : "Resolved"} matches={f.q ? res.total : undefined}>
          {/* a bit wider than Inventory's (w-72) so the whole hint "Search customer, C-number or ticket" fits */}
          <div className="w-full sm:w-80">
            <SearchBar action={BASE} defaultValue={f.q} placeholder="Search customer, C-number or ticket" hidden={{ view: reviewing ? undefined : "resolved", status: f.status || undefined }} />
          </div>
          {reviewing && (
            <NavSelect
              label="Status"
              value={f.status}
              options={[
                { value: "", label: `All (${c.needs_review})`, href: href({ status: "" }) },
                { value: "open", label: `Open (${c.open})`, href: href({ status: "open" }) },
                { value: "investigating", label: `Investigating (${c.investigating})`, href: href({ status: "investigating" }) },
              ]}
            />
          )}
        </ViewToolbar>

        {/* the list heading gets the keyboard focus when a decided row leaves the list */}
        <h2 id="flag-queue" tabIndex={-1} className="sr-only">
          {reviewing ? "Flags that need review" : "Resolved flags"}
        </h2>

        {res.rows.length ? (
          <>
            {/* from 1024px: the table */}
            <div className="hidden lg:block">
              <Table>
                <THead>
                  <TH>Customer</TH>
                  <TH>Flag reason</TH>
                  <TH>{reviewing ? "Flagged on" : "Decided on"}</TH>
                  <TH>Status</TH>
                  <TH>
                    <span className="sr-only">Action</span>
                  </TH>
                </THead>
                <TBody>
                  {res.rows.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <span className="block font-medium text-slate-900">{row.customer_name ?? "Unknown customer"}</span>
                        <span className="block font-mono text-xs text-slate-500">{customerNo(row.customer_no)}</span>
                      </TD>
                      <TD className="max-w-xs">
                        <span className="block break-words">{shortReason(row.reason, res.rule_reason)}</span>
                      </TD>
                      <TD className="whitespace-nowrap text-slate-600">{reviewing ? formatDate(row.created_at) : row.resolved_at ? formatDate(row.resolved_at) : "Not recorded"}</TD>
                      <TD>
                        <StatusCell row={row} />
                      </TD>
                      <TD align="right">
                        <RowAction row={row} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            {/* below 1024px: the same flags as compact cards (nothing scrolls sideways) */}
            <ul className="divide-y divide-slate-100 lg:hidden">
              {res.rows.map((row) => (
                <li key={row.id} className="space-y-1.5 px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block break-words font-medium text-slate-900">{row.customer_name ?? "Unknown customer"}</span>
                      <span className="block font-mono text-xs text-slate-500">{customerNo(row.customer_no)}</span>
                    </span>
                    <StatusCell row={row} />
                  </div>
                  <p className="break-words text-slate-700">{shortReason(row.reason, res.rule_reason)}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-slate-600">
                      {reviewing ? `Flagged ${formatDate(row.created_at)}` : row.resolved_at ? `Decided ${formatDate(row.resolved_at)}` : ""}
                    </span>
                    <RowAction row={row} />
                  </div>
                </li>
              ))}
            </ul>

            <Pagination
              page={res.page}
              pageSize={PAGE_SIZE}
              total={res.total}
              basePath={BASE}
              params={{ view: reviewing ? undefined : "resolved", q: f.q || undefined, status: f.status || undefined }}
            />
          </>
        ) : filtered ? (
          <EmptyState
            icon="shield"
            title="No flag matches"
            description="Try the customer's name, the C-number (C-0012) or a ticket number."
            action={
              <Link href={href({ q: "", status: "" })} className="text-sm font-medium text-navy-700 hover:underline">
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon="shield"
            title={reviewing ? "No flags need review" : "No resolved flags yet"}
            description={reviewing ? "New flags appear when a loan is issued to a customer who opened many loans in a short time." : undefined}
          />
        )}

        {/* SA6: how flags are made and what each decision does, folded away at the bottom of the list (same box as Inventory, Loans and Customers) */}
        <details className="border-t border-slate-200 px-4 py-2.5 text-sm text-slate-600">
          <summary className="cursor-pointer rounded font-medium text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
            How flags are created, and what each decision does
          </summary>
          <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="font-semibold text-slate-800">The automatic rule</dt>
              <dd>
                When a loan is issued, the system flags the customer if they opened {RULE_MIN_LOANS} or more loans in the last {RULE_WINDOW_HOURS} hours. This is a
                placeholder rule until CTM confirms its anti-money-laundering rules. A customer has at most one Open flag at a time.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Other reasons</dt>
              <dd>
                Flags with other reasons (lost ticket, high-value loan, repeated defaults) were not made by a rule in this system; they came with the sample data.
                Staff can&apos;t add a flag by hand.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Mark investigating</dt>
              <dd>The flag stays under Needs review, marked Investigating. Use it while you check with the customer.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Dismiss flag</dt>
              <dd>The activity looks normal. The flag moves to Resolved and can&apos;t be reopened. The customer is not blocked.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Blacklist customer</dt>
              <dd>
                New loans and new appraisals for the customer are refused; loans they already have don&apos;t change. The flag moves to Resolved. An Admin can lift the blacklist on the customer&apos;s
                page.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">A decision is final</dt>
              <dd>A Dismissed or Blacklisted flag can&apos;t be changed. If two Admins decide the same flag, the second one is told who already did.</dd>
            </div>
          </dl>
        </details>
      </Card>
    </div>
  );

  // the status as a word badge; on Resolved also who decided
  function StatusCell({ row }: { row: FlagRow }) {
    const s = FLAG_STATUS[row.status];
    return (
      <span className="block">
        <Badge tone={s.tone}>{s.label}</Badge>
        {!reviewing && row.resolved_by_name && <span className="mt-0.5 block text-xs text-slate-500">by {row.resolved_by_name}</span>}
        {/* SA7: who is looking into it and since when (Mark investigating saves both) */}
        {reviewing && row.status === "investigating" && row.resolved_at && (
          <span className="mt-0.5 block text-xs text-slate-500" title={formatDateTime(row.resolved_at)}>
            since {formatDate(row.resolved_at)}
            {row.resolved_by_name ? ` by ${row.resolved_by_name}` : ""}
          </span>
        )}
      </span>
    );
  }

  // one button per row: Review flag (still open) or View decision (resolved)
  function RowAction({ row }: { row: FlagRow }) {
    return reviewing ? <ReviewFlagButton flag={row} label="Review flag" /> : <ViewDecisionButton flag={row} />;
  }
}
