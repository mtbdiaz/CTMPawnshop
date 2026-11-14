import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPeso, manilaToday } from "@/lib/format";
import {
  Alert,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  Pagination,
  SectionTitle,
  SortTH,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  ViewButton,
  pageParam,
} from "@/components/ui";
import type { Enums } from "@/lib/supabase/database.types";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { DUE_SOON_DAYS, STILL_OWES_FILTER, owedDisplay, situationBadge, stateBadge } from "@/lib/loans/display"; // L3/L4/L5: one rule for badges and amounts
import { InfoTip } from "../customers/info-tip"; // the same "i" help button as on Customers
import { LoansSearch } from "./loans-search";
import { DefaultCheckButton } from "./default-check-button";
import { ViewTabs, ViewToolbar } from "@/components/view-tabs"; // D1: the shared tab row and the row under it (search + "Viewing")
import { Icon } from "@/components/icons"; // the arrow on the Admin actions row
import { candidateKey, loadDefaultCandidates } from "@/lib/loans/default-candidates"; // L30: read-only preview
import { addDaysIso } from "@/lib/loans/accrual"; // L30: due date + grace days

export const metadata = { title: "Loans" };

const PAGE_SIZE = 10; // L6: same as Customers and Appraisals, so the list fits one screen
const OPEN: Enums<"loan_status">[] = ["active", "extended", "reinstated"];
// L7: the tabs. Only stored states plus the paid / overdue rule (no new statuses).
// They overlap on purpose: Overdue, Ready to release and Reinstated are parts of Open, so the counts don't add up to All.
// L21: "help" = what the tab means, shown in "What do the loan statuses mean?" under the list. Each one was checked against the
// database functions (0017_improvement_pass.sql): reinstate_loan (Cashier, defaulted only, not if the item is queued
// for auction), forfeit_loan (Admin, defaulted only), redeem_loan (Cashier, only when ₱0 is owed), run_default_detection
// (active, renewed and reinstated loans past due date + grace period that still owe money; LC5: reinstated loans were
// skipped once, not any more since the owner decision on Matt #3).
// L32: the order of the help box below the list (all eight views). The toolbar shows five of them as tabs and the
// other three in "More views" (see PRIMARY_VIEWS / MORE_VIEWS).
const TABS = {
  open: {
    label: "Open",
    statuses: OPEN,
    help: "Loans still running: active, renewed and reinstated. Overdue and Ready to release loans are counted here too.",
  },
  overdue: {
    label: "Overdue", // past the due date AND still owes money (L1)
    statuses: OPEN,
    help: "Running loans past their due date that still owe money, reinstated ones included. Follow up with the customer.",
  },
  ready: {
    label: "Ready to release", // owes ₱0, item still in the vault (L2, same as the Dashboard)
    statuses: OPEN,
    help: "Running loans that are fully paid (₱0 owed) but the item is still in the vault. A Cashier releases it with Redeem on the loan page.",
  },
  defaulted: {
    label: "Defaulted", // can still be reinstated or forfeited
    statuses: ["defaulted"] as Enums<"loan_status">[],
    help: "Loans not paid by the due date plus the grace period. A Cashier can still reinstate one (unless its item is queued for auction), or an Admin can forfeit it.",
  },
  reinstated: {
    label: "Reinstated",
    statuses: ["reinstated"] as Enums<"loan_status">[],
    help: "Defaulted loans a Cashier reopened. They run like normal loans again and can still become overdue. The default stays on record.",
  },
  redeemed: {
    label: "Redeemed",
    statuses: ["redeemed"] as Enums<"loan_status">[],
    help: "Paid in full and the item was given back to the customer. These loans are closed.",
  },
  forfeited: {
    label: "Forfeited", // final: the item is shop property
    statuses: ["forfeited"] as Enums<"loan_status">[],
    help: "Defaulted loans an Admin closed for good. The item now belongs to the shop and nothing more is collected.",
  },
  all: {
    label: "All",
    statuses: [] as Enums<"loan_status">[],
    help: "Every loan in any status, closed ones included. Archived loans are not shown.",
  },
} as const;
// L32: one row of views (no group labels). The everyday ones are tabs; the rest are in a "More views" dropdown.
// Only one view is shown at a time, even though a loan can belong to several (e.g. Reinstated and Overdue).
const PRIMARY_VIEWS: (keyof typeof TABS)[] = ["open", "overdue", "ready", "defaulted", "all"];
const MORE_VIEWS: (keyof typeof TABS)[] = ["reinstated", "redeemed", "forfeited"];
type Tab = keyof typeof TABS;
// #23: "owed" sorts by owed_now, the amount owed today that the database works out (same rule as lib/loans/status.ts)
const SORTS: Record<string, string> = { due: "maturity_date", issued: "created_at", principal: "principal_amount", owed: "owed_now" };

export default async function LoansPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; sort?: string; dir?: string }>;
}) {
  const user = await requireRole(["cashier", "operator", "appraiser", "admin"]);
  // L0 (Phase 0): opening this list no longer runs default detection (it changed loans just by viewing).
  // A1: the database runs it every day at 12:05 AM (Matt #7); an Admin can also run it with "Check for defaults".

  const params = await searchParams;
  // "defaulted" used to mean defaulted + forfeited; the two are separate tabs now
  const tab: Tab = params.status && params.status in TABS ? (params.status as Tab) : "open";
  const q = params.q?.trim().slice(0, 60) || undefined;
  const page = pageParam(params.page);
  const timeTab = tab === "open" || tab === "overdue" || tab === "ready";
  const sort = SORTS[params.sort ?? ""] ? params.sort! : timeTab ? "due" : "issued";
  const dir = params.dir === "asc" || params.dir === "desc" ? params.dir : sort === "due" ? "asc" : "desc";
  const role = user.profile.role;
  const canCreate = hasRole(role, ["cashier"]);
  const today = manilaToday();

  const supabase = await createClient();

  // L8: search by ticket, customer name or mobile number (typed any way: 0917 123 4567, +63 917...)
  let customerIds: string[] = [];
  const safe = q ? q.replace(/[%,()*"\\]/g, " ").trim() : "";
  if (safe) {
    const ors = [`full_name.ilike.%${safe}%`];
    const digits = safe.replace(/\D/g, "");
    if (/^[+\d\s-]+$/.test(safe) && digits.length >= 4) {
      const local = digits.startsWith("63") && digits.length > 4 ? `0${digits.slice(2)}` : digits; // 63917... -> 0917...
      ors.push(`contact_number.ilike.%${local}%`);
    }
    const { data: matches } = await supabase.from("customers").select("id").or(ors.join(",")).limit(200);
    customerIds = (matches ?? []).map((c) => c.id);
  }

  // the search as one "or" filter: ticket number, or one of the customers found above
  const searchOr = safe
    ? customerIds.length
      ? `ticket_number.ilike.%${safe}%,customer_id.in.(${customerIds.join(",")})`
      : `ticket_number.ilike.%${safe}%`
    : null;

  // one tab's rule, used by the list and by the tab counts. withSearch = also apply the search (the list does, counts don't)
  type Filterable<T> = {
    in(column: "status", values: Enums<"loan_status">[]): T;
    lt(column: "maturity_date", value: string): T;
    eq(column: "principal_balance" | "interest_owed" | "damages_owed", value: number): T;
    or(filters: string): T;
  };
  const forTab = <T extends Filterable<T>>(query: T, t: Tab, withSearch: boolean): T => {
    let r = query;
    if (TABS[t].statuses.length) r = r.in("status", [...TABS[t].statuses]);
    if (t === "ready") r = r.eq("principal_balance", 0).eq("interest_owed", 0).eq("damages_owed", 0); // L2: owes ₱0 (LD: no liquidated damages either)
    const search = withSearch ? searchOr : null;
    if (t === "overdue") {
      r = r.lt("maturity_date", today); // L1: past the due date...
      // ...AND still owes money (paid loans are not overdue, was Matt #23). With a search, both "or" groups go in one
      // filter joined by and(), the same way Appraisals does it, so neither one replaces the other.
      r = r.or(search ? `and(or(${STILL_OWES_FILTER}),or(${search}))` : STILL_OWES_FILTER);
    } else if (search) {
      r = r.or(search);
    }
    return r;
  };

  const query = forTab(
    supabase
      .from("loans")
      .select("*, customers(id, full_name), appraisal_items(category, category_other, karat, weight_grams)", { count: "exact" })
      .is("archived_at", null),
    tab,
    true, // the list follows the search
  )
    .order(SORTS[sort], { ascending: dir === "asc", nullsFirst: false }) // #23: forfeited loans have no amount owed ("Item kept"), so they come last
    .order("id") // same date or amount -> always the same order, so no loan shows on two pages
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  // L7: the counts on the tabs (all loans in that tab, not just this page). They ignore the search, like Customers and
  // Appraisals; while searching, "N matches" shows how many the search found in this tab.
  const countOf = (t: Tab) => forTab(supabase.from("loans").select("id", { count: "exact", head: true }).is("archived_at", null), t, false);
  const tabKeys = Object.keys(TABS) as Tab[];
  const [{ data: loans, count, error }, ...counts] = await Promise.all([query, ...tabKeys.map((t) => countOf(t))]);
  const countFor = Object.fromEntries(tabKeys.map((t, i) => [t, counts[i].count ?? 0])) as Record<Tab, number>;
  // L30: Admin only, READ-ONLY: which loans "Check for defaults" would change, shown before anything runs
  const defaults = role === "admin" ? await loadDefaultCandidates(today) : null;

  // what to keep in every link (tab, search, sort)
  const listParams = { status: tab === "open" ? undefined : tab, q, sort: params.sort, dir: params.dir };
  const href = (overrides: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...listParams, ...overrides })) if (v) qs.set(k, v);
    const s = qs.toString();
    return s ? `/dashboard/loans?${s}` : "/dashboard/loans";
  };

  // a page past the end (old link after a search): back to page 1 instead of the error page (PGRST103, same fix as Customers)
  const pastEnd = error?.code === "PGRST103" && page > 1;
  if (error && !pastEnd) throw error;
  if (pastEnd || ((loans?.length ?? 0) === 0 && (count ?? 0) > 0 && page > 1)) redirect(href({ page: undefined }));

  type Row = NonNullable<typeof loans>[number] & {
    customers: { id: string; full_name: string } | null;
    appraisal_items: { category: string; category_other: string | null; karat: number; weight_grams: number } | null;
  };
  const rows = (loans ?? []) as unknown as Row[];
  const itemOf = (l: Row) => (l.appraisal_items ? `${categoryLabel(l.appraisal_items.category, l.appraisal_items.category_other)}, ${l.appraisal_items.karat}K` : "");
  // L5: the "Owed now" cell. Forfeited loans aren't collected, so they say so instead of an amount
  const owedCell = (l: Row) => {
    const owed = owedDisplay(l, today);
    return owed === null ? <span className="text-xs text-slate-500">Item kept</span> : formatPeso(owed);
  };
  // L3/L4: the state badge, plus the payment situation when there is one
  const badges = (l: Row) => {
    const state = stateBadge(l.status);
    const situation = situationBadge(l, today);
    return (
      <span className="flex flex-wrap gap-1">
        <StatusBadge status={state.status} label={state.label} />
        {situation && <StatusBadge status={situation.status} label={situation.label} />}
      </span>
    );
  };
  const searching = Boolean(q);

  return (
    <div>
      <PageHeader
        title={
          <>
            Loans
            {/* L30: the TOTAL number of loans (like Customers). Each tab shows its own count, and the pager "Showing 1–10 of N" */}
            <span className="ml-2 font-sans text-base font-normal tracking-normal text-slate-500">({countFor.all.toLocaleString("en-PH")})</span>
          </>
        }
        // the subtitle matches what this role can do (Operator and Appraiser can only look)
        description={
          canCreate
            ? "Open a loan to record payments, renew, capitalize, reinstate or redeem."
            : "Open a loan to see its balance, payments, renewals and item. Only a Cashier or Admin can change a loan."
        }
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Loans" }]}
        // L30: only the everyday action up here. "Check for defaults" changes records, so it moved to Admin actions under the list
        actions={
          canCreate ? (
            <ButtonLink href="/dashboard/loans/new" variant="primary">
              New loan
            </ButtonLink>
          ) : undefined
        }
      />

      <Card padded={false}>
        {/* L32: the toolbar. Row 1 = the views (5 tabs + "More views"), underlined like page tabs. Row 2 = search, and on
            the right which view is showing. Wraps on small screens; nothing is cut off. */}
        {/* D1: the same tab row as every other page (components/view-tabs.tsx). Amber dot on Overdue, red on Defaulted */}
        <ViewTabs
          label="Loan views"
          current={tab}
          tabs={PRIMARY_VIEWS.map((t) => ({
            value: t, // the tab's id
            label: TABS[t].label, // its name
            count: countFor[t], // how many loans are in it
            tone: t === "overdue" ? ("warning" as const) : t === "defaulted" ? ("danger" as const) : undefined, // the dot
            // opening a tab goes back to page 1 and that tab's own default sort
            href: href({ status: t === "open" ? undefined : t, page: undefined, sort: undefined, dir: undefined }),
          }))}
          // Reinstated, Redeemed and Forfeited in the "More views" dropdown
          more={{
            options: MORE_VIEWS.map((t) => ({
              value: t,
              label: TABS[t].label,
              count: countFor[t],
              href: href({ status: t, page: undefined, sort: undefined, dir: undefined }),
            })),
          }}
        />
        {/* D1: the shared row under the tabs: search on the left, "Viewing: Open" (or "N matches in Open") on the right */}
        <ViewToolbar viewing={TABS[tab].label} matches={searching ? (count ?? 0) : undefined}>
          <div className="w-full sm:w-96">
            <LoansSearch defaultValue={q} keep={{ status: listParams.status, sort: params.sort, dir: params.dir }} />
          </div>
        </ViewToolbar>
        {rows.length > 0 ? (
          <>
            {/* L13: CARDS below 1100px (phones, tablets, big zoom): nothing scrolls sideways */}
            <ul className="divide-y divide-slate-100 min-[1100px]:hidden">
              {rows.map((l) => (
                <li key={l.id}>
                  <Link href={`/dashboard/loans/${l.id}`} className="block px-4 py-3 hover:bg-slate-50">
                    {/* line 1: ticket + customer on the left, owed now on the right */}
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block font-mono text-xs text-slate-600">{l.ticket_number}</span>
                        <span className="block font-medium text-slate-900">{l.customers?.full_name ?? ""}</span>
                      </span>
                      <span className="shrink-0 text-right text-sm tabular-nums">
                        <span className="block text-xs text-slate-500">Owed now</span>
                        <span className="font-semibold text-navy-900">{owedCell(l)}</span>
                      </span>
                    </span>
                    {/* line 2: item, due date */}
                    <span className="mt-0.5 block text-sm text-slate-600">
                      {itemOf(l)} · Due {formatDate(l.maturity_date)}
                    </span>
                    {/* line 3: badges */}
                    <span className="mt-1.5 block">{badges(l)}</span>
                  </Link>
                </li>
              ))}
            </ul>

            {/* COMPUTERS (1100px and wider): the table. Never taller than the screen, so the page buttons stay visible */}
            <div className="hidden min-[1100px]:block">
              <Table
                minWidth="980px"
                className="relative max-h-[max(16rem,calc(100dvh-22rem))] overflow-y-auto [&_thead]:bg-slate-100 [&_thead]:text-slate-700 [&_th]:font-semibold"
              >
                <THead sticky>
                  <TH>Ticket</TH>
                  <TH>Customer</TH>
                  <TH>Item</TH>
                  {/* L11: say which principal this is */}
                  <SortTH label="Original principal" column="principal" current={sort} dir={dir} basePath="/dashboard/loans" params={listParams} align="right" />
                  {/* #23: Owed now can be sorted (the database works out the same amount the page shows) */}
                  <SortTH label="Owed now" column="owed" current={sort} dir={dir} basePath="/dashboard/loans" params={listParams} align="right">
                    {/* RW3 (Nov 14): + liquidated damages (0073). Before: "Principal still unpaid plus interest, including interest added
                        for each 30 days past the due date." The amount itself already came from the shared owedNow / owed_now */}
                    <InfoTip label="Owed now">
                        Unpaid principal + interest (including interest added for each 30 days past the due date) + liquidated damages, which are added for each 30 days after the grace period ends. It is the amount to redeem today. Original principal is the amount first lent. Forfeited loans show &quot;Item kept&quot;: the item became shop property and the loan is not collected.
                      </InfoTip>
                  </SortTH>
                  <SortTH label="Due" column="due" current={sort} dir={dir} basePath="/dashboard/loans" params={listParams} />
                  <TH>Status</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </THead>
                <TBody>
                  {rows.map((l) => (
                    // L10: no red rows any more; the "Overdue" badge says it
                    <TR key={l.id}>
                      <TD mono className="whitespace-nowrap">
                        {l.ticket_number}
                      </TD>
                      <TD className="font-medium">
                        {/* L9: the name opens the customer's profile; View loan stays its own button */}
                        {l.customers ? (
                          <Link
                            href={`/dashboard/customers/${l.customers.id}`}
                            className="rounded-sm underline-offset-2 hover:text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
                          >
                            {l.customers.full_name}
                          </Link>
                        ) : (
                          ""
                        )}
                      </TD>
                      <TD className="whitespace-nowrap text-slate-600">{itemOf(l)}</TD>
                      <TD align="right" className="tabular-nums">
                        {formatPeso(l.principal_amount)}
                      </TD>
                      <TD align="right" className="font-medium tabular-nums">
                        {owedCell(l)}
                      </TD>
                      <TD className="whitespace-nowrap">{formatDate(l.maturity_date)}</TD>
                      <TD>{badges(l)}</TD>
                      <TD align="right">
                        <ViewButton href={`/dashboard/loans/${l.id}`}>View loan</ViewButton>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/dashboard/loans" params={listParams} />
          </>
        ) : (
          <EmptyState
            icon="ticket"
            title={searching ? "No loans match your search" : tab === "ready" ? "No paid loans waiting for release" : `No ${TABS[tab].label.toLowerCase()} loans`}
            description={searching ? "Try the full ticket number, the customer's name or their mobile number." : undefined}
          />
        )}
        {/* L21: what each tab means, under the list. Same fold-out box as Customers ("What do AML check... mean?"):
            closed by default so it takes one line. <details>/<summary> is built into the browser: click, Enter or Space
            opens and closes it, and screen readers hear "expanded" / "collapsed" on their own. It only shows text,
            it doesn't load or change anything. */}
        <details className="border-t border-slate-200 px-4 py-2.5 text-sm text-slate-600">
          {/* rounded + focus-visible ring = a clear outline when you reach it with Tab (mouse clicks don't show it) */}
          <summary className="cursor-pointer rounded font-medium text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
            What do the loan statuses mean?
          </summary>
          {/* one short definition per tab, in the same order as the tabs */}
          <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            {tabKeys.map((t) => (
              <div key={t}>
                <dt className="font-semibold text-slate-800">{TABS[t].label}</dt>
                <dd>{TABS[t].help}</dd>
              </div>
            ))}
          </dl>
          {/* the overlap note, so nobody adds the counts together */}
          <p className="mt-3">
            <span className="font-semibold text-slate-800">Some tabs overlap.</span> Overdue, Ready to release and Reinstated are
            all part of Open, so one loan can be in more than one tab. For example, a reinstated loan past its due date shows in
            Open, Reinstated and Overdue. Don&apos;t add the tab counts together: only Open + Defaulted + Forfeited + Redeemed = All.
          </p>
          {/* what the two badges on each loan mean */}
          <p className="mt-1.5">
            On each loan, the first badge is its status. A second badge shows Overdue, Due soon (due within {DUE_SOON_DAYS} days)
            or Paid, ready to release.
          </p>
        </details>
      </Card>

      {/* L30: Admin actions, closed by default (same look as on the loan page and customer profile).
          "Check for defaults" CHANGES loans, so it is kept away from everyday buttons and shows the exact list first.
          Nothing runs when this opens: the list is read-only until the Admin presses the button and confirms. */}
      {defaults && (
        <section className="mt-6">
          <SectionTitle description="Rarely needed. Changes loan records, so it shows which loans first and asks you to confirm. Each change is saved in the audit trail.">
            Admin actions
          </SectionTitle>
          <Card padded={false}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-500 [&::-webkit-details-marker]:hidden">
                <span>
                  <span className="block font-medium text-slate-900">Check for defaults</span>
                  <span className="block text-sm text-slate-600">
                    {/* A1: "still owes money" is part of the rule now (Matt #1), so the summary says so */}
                    {defaults.error
                      ? "Couldn't load the list. Reload the page."
                      : defaults.candidates.length === 0
                        ? "Nothing to change today." // A1: the 12:05 AM note is inside the box, once
                        : `${defaults.candidates.length} active, renewed or reinstated loan${defaults.candidates.length === 1 ? " is" : "s are"} past the grace period and still ${defaults.candidates.length === 1 ? "owes" : "owe"} money.`}
                  </span>
                </span>
                <Icon name="chevron-down" className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-3 border-t border-slate-100 px-5 py-4 text-sm">
                {/* A1: Matt #7 - the database runs this check every night. The "don't wait" part only shows when there is a button */}
                <p className="text-slate-600">
                  The database checks for defaults by itself every day at 12:05 AM.
                  {/* only when there are loans to change (the button shows), say what the button is for */}
                  {!defaults.error && defaults.candidates.length > 0 && " Use the button below only if you don't want to wait until tonight."}
                </p>
                {/* A1: fully paid loans past the grace period. The database skips them since Matt's fix #1, so they no longer
                    block the check. Listed (with links) so the Admin knows the item is waiting to be released with Redeem. */}
                {!defaults.error && defaults.paid.length > 0 && (
                  <Alert tone="info" title={`${defaults.paid.length} fully paid loan${defaults.paid.length === 1 ? " is" : "s are"} skipped`}>
                    {defaults.paid.length === 1 ? "It is" : "They are"} past the grace period, but nothing is owed, so the check leaves{" "}
                    {defaults.paid.length === 1 ? "it" : "them"} alone. Release the item with Redeem:{" "}
                    {defaults.paid.map((l, i) => (
                      <span key={l.id}>
                        {/* a comma between tickets, none before the first */}
                        {i > 0 && ", "}
                        {/* the ticket links to its loan page, where Redeem is */}
                        <Link href={`/dashboard/loans/${l.id}`} className="font-mono underline underline-offset-2">
                          {l.ticket_number}
                        </Link>
                      </span>
                    ))}
                    .
                  </Alert>
                )}
                {defaults.error ? (
                  <p className="text-slate-600">The list couldn&apos;t be loaded, so the check can&apos;t run. Reload the page and try again.</p>
                ) : defaults.candidates.length === 0 ? (
                  <p className="text-slate-600">
                    {/* A1: "that still owe money" added (Matt #1) */}
                    {/* RW4 (Nov 14): + reinstated (the database checks them too, and so does this page's list). Before: "Only active and renewed loans ..." */}
                    Nothing would change. Only active, renewed and reinstated loans that still owe money are checked, and only after the due date plus the grace period.
                  </p>
                ) : (
                  <>
                    <p className="text-slate-600">
                      {/* A1: since Matt's fix #2 the items stay in the vault until an Admin forfeits each loan */}
                      These loans would move to Defaulted. Their items stay in the vault until an Admin forfeits each loan,
                      and a Cashier can still reinstate one.
                    </p>
                    {/* the exact list (no inner scroll box): ticket, customer, due date, grace end, amount owed */}
                    <Table minWidth="560px">
                      <THead>
                        <TH>Ticket</TH>
                        <TH>Customer</TH>
                        <TH>Due</TH>
                        <TH>Grace ended</TH>
                        <TH align="right">Owed now</TH>
                      </THead>
                      <TBody>
                        {defaults.candidates.map((l) => (
                          <TR key={l.id}>
                            <TD mono>
                              <Link href={`/dashboard/loans/${l.id}`} className="text-navy-700 underline-offset-2 hover:underline">
                                {l.ticket_number}
                              </Link>
                            </TD>
                            <TD>{l.customers?.full_name ?? ""}</TD>
                            <TD>{formatDate(l.maturity_date)}</TD>
                            <TD>{formatDate(addDaysIso(l.maturity_date, Number(l.grace_period_days ?? 0)))}</TD>
                            <TD align="right">{formatPeso(owedDisplay(l, today) ?? 0)}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                    {/* A1: no longer turned off by paid loans: they aren't in this list anymore */}
                    <DefaultCheckButton expected={candidateKey(defaults.candidates)} count={defaults.candidates.length} />
                  </>
                )}
              </div>
            </details>
          </Card>
        </section>
      )}
    </div>
  );
}
