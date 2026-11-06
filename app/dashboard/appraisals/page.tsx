import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPeso } from "@/lib/format";
import { ITEM_CATEGORIES, categoryLabel } from "@/lib/appraisal/valuation";
import type { Enums } from "@/lib/supabase/database.types";
import { Badge, Card, EmptyState, FilterTabs, PageHeader, Pagination, SortTH, Table, TBody, TD, TH, THead, TR, ViewButton, pageParam } from "@/components/ui";
import { AppraisalFilters } from "./appraisal-filters";
import { NewAppraisalDialog } from "./new-appraisal-dialog";
import { InfoTip } from "../customers/info-tip"; // the same "i" help button as on Customers

export const metadata = { title: "Appraisals" };

const PAGE_SIZE = 10; // B1: same as Customers, so the list fits one screen
// B2: the three tabs. Only what the database already stores, no new statuses.
//   available = not pawned, not archived, and no open or confirmed counterfeit flag (so it can be pawned)
//   review    = flagged and waiting for an Admin
//   confirmed = an Admin confirmed the risk (never pawnable, kept for the record, not archived automatically)
type Tab = "available" | "review" | "confirmed";
const SORTS: Record<string, string> = { appraised: "created_at", value: "computed_value", weight: "weight_grams" }; // B7: sortable columns
const AVAILABLE_OR = "is_counterfeit_risk.eq.false,counterfeit_resolution.eq.cleared"; // no flag, or the flag was cleared

// Item 4: the Appraisals tab is the pre-pawn pool. Pawned, redeemed and
// archived items never appear here.
export default async function AppraisalsPage({
  searchParams,
}: {
  searchParams: Promise<{ risk?: string; category?: string; page?: string; new?: string; q?: string; sort?: string; dir?: string }>;
}) {
  const user = await requireRole(["appraiser", "cashier", "operator", "admin"]);
  const params = await searchParams;
  const page = pageParam(params.page);
  // B2: which tab. "pending" is the old address the Dashboard alert still links to
  const tab: Tab = params.risk === "pending" || params.risk === "review" ? "review" : params.risk === "confirmed" ? "confirmed" : "available";
  const category = ITEM_CATEGORIES.some((c) => c.value === params.category) ? (params.category as Enums<"item_category">) : null;
  const q = params.q?.trim().slice(0, 60) || undefined; // B4: the search text (max 60 characters)
  const sort = SORTS[params.sort ?? ""] ? params.sort! : "appraised";
  // B7: newest first, except Awaiting review: oldest first, so old cases get handled
  const dir = params.dir === "asc" || params.dir === "desc" ? params.dir : tab === "review" && sort === "appraised" ? "asc" : "desc";
  const canAppraise = hasRole(user.profile.role, ["appraiser"]);

  // B4: what the search box matches: notes, the "Others" description, a category name, or a karat ("18" / "18K")
  const searchOr = (() => {
    if (!q) return null;
    const safe = q.replace(/[%,()*"\\]/g, " ").trim(); // characters that would break the database filter
    if (!safe) return null;
    // notes and the "Others" description: a word that starts with the search ("ring" finds "ring" and "ring size", not "earring").
    // imatch = case-insensitive pattern; \m = start of a word; other pattern characters are escaped first
    const word = safe.replace(/[.^$|?+{}[\]]/g, "\\$&");
    const ors = [`condition_notes.imatch.\\m${word}`, `category_other.imatch.\\m${word}`];
    // a category whose name has a word starting with the search: "ring" -> Ring (not Earrings), "chain" -> Chain + Pendant w/ Chain
    const cats = ITEM_CATEGORIES.filter((c) => c.label.toLowerCase().split(/[^a-z]+/).some((word) => word && word.startsWith(safe.toLowerCase()))).map((c) => c.value);
    if (cats.length) ors.push(`category.in.(${cats.join(",")})`);
    const karat = safe.match(/^(24|21|18)\s*k?$/i); // "18k" -> 18K items
    if (karat) ors.push(`karat.eq.${karat[1]}`);
    return ors.join(",");
  })();

  const supabase = await createClient();
  // B2: one tab's rule, used by the list and by the tab counts
  type Filterable<T> = { eq(column: "is_counterfeit_risk" | "counterfeit_resolution", value: boolean | "pending" | "confirmed"): T; or(filters: string): T };
  const forTab = <T extends Filterable<T>>(query: T, t: Tab, withSearch: boolean): T => {
    let r = query;
    if (t === "review") r = r.eq("is_counterfeit_risk", true).eq("counterfeit_resolution", "pending");
    if (t === "confirmed") r = r.eq("is_counterfeit_risk", true).eq("counterfeit_resolution", "confirmed");
    if (withSearch && searchOr) {
      // available + search = (no flag OR cleared) AND (search matches): one nested filter, so both apply
      r = t === "available" ? r.or(`and(or(${AVAILABLE_OR}),or(${searchOr}))`) : r.or(searchOr);
    } else if (t === "available") {
      r = r.or(AVAILABLE_OR);
    }
    return r;
  };

  let query = forTab(
    supabase
      .from("appraisal_items")
      .select("id, category, category_other, karat, weight_grams, computed_value, suggested_loan_max, is_counterfeit_risk, counterfeit_resolution, appraised_by, created_at", { count: "exact" })
      .eq("status", "available") // not pawned
      .is("archived_at", null), // not archived
    tab,
    true,
  )
    .order(SORTS[sort], { ascending: dir === "asc" })
    .order("id") // same date or value -> always the same order, so nothing shows on two pages
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (category) query = query.eq("category", category);

  // B2: tab counts (all items in that tab, like the Customers tabs)
  const countOf = (t: Tab) =>
    forTab(supabase.from("appraisal_items").select("id", { count: "exact", head: true }).eq("status", "available").is("archived_at", null), t, false);
  const [{ data: rows, count, error }, { count: nAvailable }, { count: nReview }, { count: nConfirmed }, { data: settings }] = await Promise.all([
    query,
    countOf("available"),
    countOf("review"),
    countOf("confirmed"),
    supabase.from("system_settings").select("price_24k, price_21k, price_18k, ltv_percent").eq("id", 1).maybeSingle(),
  ]);
  // PGRST103 = a page past the end (e.g. an old link after a search): the database refuses it instead of returning
  // an empty list, so that case goes back to page 1 below instead of showing the error page.
  const pastEnd = error?.code === "PGRST103" && page > 1;
  if (error && !pastEnd) throw error;

  // keeps the tab, search, category and sort in every link
  const listParams = { risk: tab === "available" ? undefined : tab, q, category: category ?? undefined, sort: params.sort, dir: params.dir };
  const href = (overrides: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...listParams, ...overrides })) if (v) qs.set(k, v);
    const s = qs.toString();
    return s ? `/dashboard/appraisals?${s}` : "/dashboard/appraisals";
  };

  // a page past the last one (e.g. an old link after a search) -> the last page instead of an empty list
  if (pastEnd || ((rows?.length ?? 0) === 0 && (count ?? 0) > 0 && page > 1)) {
    const last = pastEnd ? 1 : Math.ceil((count ?? 0) / PAGE_SIZE);
    redirect(href({ page: last > 1 ? String(last) : undefined }));
  }

  // B5: who appraised each item. Staff can only read names the database lets them read
  // (all names for Admin; their own for others until Matt #11), so we never guess a name.
  const staffIds = [...new Set((rows ?? []).map((r) => r.appraised_by).filter((x): x is string => Boolean(x)))];
  const { data: staff } = staffIds.length ? await supabase.from("profiles").select("id, full_name").in("id", staffIds) : { data: [] };
  const names = new Map((staff ?? []).map((p) => [p.id, p.full_name]));
  const appraisedBy = (id: string | null) => (!id ? "Not recorded" : id === user.id ? "You" : (names.get(id) ?? "Other staff"));

  // B3: words for the counterfeit check. "No flag" (not "OK"): nobody flagged it, it was not certified genuine
  const check = (a: { is_counterfeit_risk: boolean; counterfeit_resolution: string | null }) =>
    !a.is_counterfeit_risk ? (
      <span className="text-slate-600">No flag</span>
    ) : a.counterfeit_resolution === "cleared" ? (
      <Badge tone="success">Cleared</Badge>
    ) : a.counterfeit_resolution === "confirmed" ? (
      <Badge tone="danger" icon>
        Confirmed risk
      </Badge>
    ) : (
      <Badge tone="warning">Awaiting review</Badge>
    );

  const searching = Boolean(q || category);
  const emptyTitle = searching
    ? "No appraisals match your search."
    : tab === "review"
      ? "No items awaiting counterfeit review."
      : tab === "confirmed"
        ? "No confirmed counterfeit risks."
        : "No available items.";

  return (
    <div>
      <PageHeader
        // B2: the number of items that can be pawned, next to the title (like Customers)
        title={
          <>
            Appraisals
            <span className="ml-2 font-sans text-base font-normal tracking-normal text-slate-500">({nAvailable ?? 0})</span>
          </>
        }
        description="Items appraised and waiting to be pawned. Once a loan is issued against an item it leaves this list."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Appraisals" }]}
        // C1: New appraisal is a header button that opens a popup (Appraiser and Admin), like Register customer
        actions={canAppraise && settings ? <NewAppraisalDialog prices={settings} ltvPercent={Number(settings.ltv_percent)} defaultOpen={params.new === "1"} /> : undefined}
      />

      <Card padded={false}>
        {/* search + category on the left, tabs on the right (they stack on small screens) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <AppraisalFilters defaultQuery={q} category={category ?? ""} keep={{ risk: listParams.risk, sort: params.sort, dir: params.dir }} />
          {/* how many match, only when searching. aria-live = screen readers hear the new count */}
          {searching && (
            <p aria-live="polite" className="mr-auto text-sm text-slate-600">
              {count ?? 0} match{count === 1 ? "" : "es"}
            </p>
          )}
          {/* B2: the three tabs with real counts. Changing tab keeps the search and category, back to page 1 */}
          <FilterTabs
            current={tab}
            tabs={[
              { label: "Available", value: "available", href: href({ risk: undefined, sort: undefined, dir: undefined }), count: nAvailable ?? 0 },
              { label: "Awaiting review", value: "review", href: href({ risk: "review", sort: undefined, dir: undefined }), count: nReview ?? 0, tone: "warning" },
              { label: "Confirmed risk", value: "confirmed", href: href({ risk: "confirmed", sort: undefined, dir: undefined }), count: nConfirmed ?? 0, tone: "danger" },
            ]}
          />
        </div>
        {rows && rows.length > 0 ? (
          <>
            {/* D1: CARDS below 1100px (phones, tablets, big zoom), like Customers: nothing scrolls sideways */}
            <ul className="divide-y divide-slate-100 min-[1100px]:hidden">
              {rows.map((a) => (
                <li key={a.id}>
                  <Link href={`/dashboard/appraisals/${a.id}`} className="block px-4 py-3 hover:bg-slate-50">
                    {/* line 1: item on the left, maximum loan on the right */}
                    <span className="flex items-start justify-between gap-3">
                      <span className="font-medium text-slate-900">
                        {categoryLabel(a.category, a.category_other)}, {a.karat}K
                      </span>
                      <span className="shrink-0 text-right text-sm tabular-nums">
                        <span className="block text-xs text-slate-500">Maximum loan</span>
                        <span className="font-semibold text-navy-900">{formatPeso(a.suggested_loan_max)}</span>
                      </span>
                    </span>
                    {/* line 2: weight, value, date, who */}
                    <span className="mt-0.5 block text-sm text-slate-600">
                      {a.weight_grams} g · Value {formatPeso(a.computed_value)} · {formatDate(a.created_at)} · {appraisedBy(a.appraised_by)}
                    </span>
                    {/* line 3: the counterfeit check, always shown */}
                    <span className="mt-1.5 flex items-center gap-1.5 text-sm">
                      <span className="text-slate-500">Counterfeit check:</span> {check(a)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            {/* COMPUTERS (1100px and wider): the table. Never taller than the screen allows, so the page buttons stay
                visible; the headings stay on top if the rows scroll (same as Customers) */}
            <div className="hidden min-[1100px]:block">
              <Table
                minWidth="900px"
                className="relative max-h-[max(16rem,calc(100dvh-22rem))] overflow-y-auto [&_thead]:bg-slate-100 [&_thead]:text-slate-700 [&_th]:font-semibold"
              >
                <THead sticky>
                  <TH>Item</TH>
                  <SortTH label="Weight" column="weight" current={sort} dir={dir} basePath="/dashboard/appraisals" params={listParams} align="right" />
                  <SortTH label="Appraised value" column="value" current={sort} dir={dir} basePath="/dashboard/appraisals" params={listParams} align="right" />
                  {/* R1: "i" button that explains the two amounts, using the LTV set in Settings */}
                  <TH align="right">
                    <span className="inline-flex items-center gap-1">
                      Maximum loan
                      <InfoTip label="Maximum loan">
                        Appraised value = weight × today&apos;s price per gram for the karat (set by an Admin in Settings). Maximum loan = appraised value × LTV
                        {settings ? ` (${Number(settings.ltv_percent)}% now)` : ""}. It is the most a Cashier can lend on the item; the loan can be lower. The amounts are fixed when the item is appraised.
                      </InfoTip>
                    </span>
                  </TH>
                  <TH>Counterfeit check</TH>
                  <TH>Appraised by</TH>
                  <SortTH label="Appraised" column="appraised" current={sort} dir={dir} basePath="/dashboard/appraisals" params={listParams} />
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </THead>
                <TBody>
                  {rows.map((a) => (
                    <TR key={a.id}>
                      {/* whitespace-nowrap = "Bracelet, 18K" stays on one line at 1280px */}
                      <TD className="whitespace-nowrap font-medium">
                        {/* the item is also a link, like customer names */}
                        <Link
                          href={`/dashboard/appraisals/${a.id}`}
                          className="rounded-sm underline-offset-2 hover:text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
                        >
                          {categoryLabel(a.category, a.category_other)}, {a.karat}K
                        </Link>
                      </TD>
                      <TD align="right" className="tabular-nums">
                        {a.weight_grams} g
                      </TD>
                      <TD align="right" className="tabular-nums">
                        {formatPeso(a.computed_value)}
                      </TD>
                      <TD align="right" className="font-medium tabular-nums">
                        {formatPeso(a.suggested_loan_max)}
                      </TD>
                      <TD>{check(a)}</TD>
                      {/* R2: long names stay on one line and end with "..."; hover shows the full name */}
                      <TD className="text-slate-600">
                        <span className="block max-w-[10rem] truncate" title={appraisedBy(a.appraised_by)}>
                          {appraisedBy(a.appraised_by)}
                        </span>
                      </TD>
                      <TD className="whitespace-nowrap text-slate-600">{formatDate(a.created_at)}</TD>
                      <TD align="right">
                        <ViewButton href={`/dashboard/appraisals/${a.id}`}>View appraisal</ViewButton>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/dashboard/appraisals" params={listParams} />
          </>
        ) : (
          <EmptyState
            title={emptyTitle}
            description={searching ? "Try another word, or choose All categories." : canAppraise && tab === "available" ? "Use New appraisal to add one." : undefined}
          />
        )}
      </Card>
    </div>
  );
}
