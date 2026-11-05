import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPeso, manilaToday } from "@/lib/format";
import {
  ButtonLink,
  Card,
  EmptyState,
  FilterTabs,
  PageHeader,
  Pagination,
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

export const metadata = { title: "Loans" };

const PAGE_SIZE = 10; // L6: same as Customers and Appraisals, so the list fits one screen
const OPEN: Enums<"loan_status">[] = ["active", "extended", "reinstated"];
// L7: the tabs. Only stored states plus the paid / overdue rule (no new statuses).
// They overlap on purpose: Overdue, Ready to release and Reinstated are parts of Open, so the counts don't add up to All.
// L21: "help" = what the tab means, shown in "What do the loan statuses mean?" under the list. Each one was checked against the
// database functions (0017_improvement_pass.sql): reinstate_loan (Cashier, defaulted only, not if the item is queued
// for auction), forfeit_loan (Admin, defaulted only), redeem_loan (Cashier, only when ₱0 is owed), run_default_detection
// (active/renewed loans past due date + grace period; reinstated loans are skipped).
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
  reinstated: {
    label: "Reinstated",
    statuses: ["reinstated"] as Enums<"loan_status">[],
    help: "Defaulted loans a Cashier reopened. They run like normal loans again and can still become overdue. The default stays on record.",
  },
  defaulted: {
    label: "Defaulted", // can still be reinstated or forfeited
    statuses: ["defaulted"] as Enums<"loan_status">[],
    help: "Loans not paid by the due date plus the grace period. A Cashier can still reinstate one (unless its item is queued for auction), or an Admin can forfeit it.",
  },
  forfeited: {
    label: "Forfeited", // final: the item is shop property
    statuses: ["forfeited"] as Enums<"loan_status">[],
    help: "Defaulted loans an Admin closed for good. The item now belongs to the shop and nothing more is collected.",
  },
  redeemed: {
    label: "Redeemed",
    statuses: ["redeemed"] as Enums<"loan_status">[],
    help: "Paid in full and the item was given back to the customer. These loans are closed.",
  },
  all: {
    label: "All",
    statuses: [] as Enums<"loan_status">[],
    help: "Every loan in any status, closed ones included. Archived loans are not shown.",
  },
} as const;
type Tab = keyof typeof TABS;
const SORTS: Record<string, string> = { due: "maturity_date", issued: "created_at", principal: "principal_amount" };

export default async function LoansPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; sort?: string; dir?: string }>;
}) {
  const user = await requireRole(["cashier", "operator", "appraiser", "admin"]);
  // L0 (Phase 0): opening this list no longer runs default detection (it changed loans just by viewing,
  // and could default a fully paid loan, Matt #1). An Admin runs it with "Check for defaults now".

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
    eq(column: "principal_balance" | "interest_owed", value: number): T;
    or(filters: string): T;
  };
  const forTab = <T extends Filterable<T>>(query: T, t: Tab, withSearch: boolean): T => {
    let r = query;
    if (TABS[t].statuses.length) r = r.in("status", [...TABS[t].statuses]);
    if (t === "ready") r = r.eq("principal_balance", 0).eq("interest_owed", 0); // L2: owes ₱0
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
    .order(SORTS[sort], { ascending: dir === "asc" })
    .order("id") // same date or amount -> always the same order, so no loan shows on two pages
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  // L7: the counts on the tabs (all loans in that tab, not just this page). They ignore the search, like Customers and
  // Appraisals; while searching, "N matches" shows how many the search found in this tab.
  const countOf = (t: Tab) => forTab(supabase.from("loans").select("id", { count: "exact", head: true }).is("archived_at", null), t, false);
  const tabKeys = Object.keys(TABS) as Tab[];
  const [{ data: loans, count, error }, ...counts] = await Promise.all([query, ...tabKeys.map((t) => countOf(t))]);
  const countFor = Object.fromEntries(tabKeys.map((t, i) => [t, counts[i].count ?? 0])) as Record<Tab, number>;

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
            <span className="ml-2 font-sans text-base font-normal tracking-normal text-slate-500">({countFor.open})</span>
          </>
        }
        // the subtitle matches what this role can do (Operator and Appraiser can only look)
        description={
          canCreate
            ? "Open a loan to record payments, renew, capitalize, reinstate or redeem."
            : "Open a loan to see its balance, payments, renewals and item. Only a Cashier or Admin can change a loan."
        }
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Loans" }]}
        actions={
          <>
            {/* L0: Admin only; the server checks too */}
            {role === "admin" && <DefaultCheckButton />}
            {canCreate && (
              <ButtonLink href="/dashboard/loans/new" variant="primary">
                New loan
              </ButtonLink>
            )}
          </>
        }
      />

      <Card padded={false}>
        {/* search on the left, tabs on the right (they stack on small screens) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <LoansSearch defaultValue={q} keep={{ status: listParams.status, sort: params.sort, dir: params.dir }} />
          {searching && (
            <p aria-live="polite" className="mr-auto text-sm text-slate-600">
              {count ?? 0} match{count === 1 ? "" : "es"}
            </p>
          )}
          {/* L7: tabs with counts. Overdue = amber dot, Defaulted = red dot (the words and counts carry the meaning too) */}
          <FilterTabs
            current={tab}
            tabs={tabKeys.map((t) => ({
              value: t,
              label: TABS[t].label,
              href: href({ status: t === "open" ? undefined : t, page: undefined, sort: undefined, dir: undefined }),
              count: countFor[t],
              tone: t === "overdue" ? ("warning" as const) : t === "defaulted" ? ("danger" as const) : undefined,
            }))}
          />
        </div>
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
                  <TH align="right">
                    <span className="inline-flex items-center gap-1">
                      Owed now
                      <InfoTip label="Owed now">
                        Principal still unpaid plus interest, including interest added for each 30 days past the due date. It is the amount to redeem today. Original principal is the amount first lent. Forfeited loans show &quot;Item kept&quot;: the item became shop property and the loan is not collected.
                      </InfoTip>
                    </span>
                  </TH>
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
    </div>
  );
}
