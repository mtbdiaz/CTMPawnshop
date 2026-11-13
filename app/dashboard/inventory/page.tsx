import Link from "next/link"; // normal links (appraisal, customer, loan)
import { redirect } from "next/navigation"; // sends an old page link back to page 1
import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDate, manilaToday } from "@/lib/format";
import type { Enums } from "@/lib/supabase/database.types";
import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
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
import { ITEM_CATEGORIES, categoryLabel } from "@/lib/appraisal/valuation";
import { ViewTabs, ViewToolbar } from "@/components/view-tabs"; // D1: the shared tab row and the row under it ("Viewing")
import { NavSelect } from "@/components/nav-select"; // D2: the same dropdown as Appraisals' Category
import { situationBadge, stateBadge } from "@/lib/loans/display"; // the same loan badges as the Loans page
import { CHANGE_WORDS, CUSTODY, daysHeld, historySummary, manilaDateOf, parseInventorySearch, type InventoryStatus } from "@/lib/inventory/custody"; // V1
import { InventorySearch } from "./inventory-search";

export const metadata = { title: "Inventory" };

const PAGE_SIZE = 10; // V1: was 30. Same as Customers, Appraisals, Loans and Reminders
const BASE = "/dashboard/inventory";
const ROW_CHUNK = 1000; // the database returns at most 1,000 rows per request, so locations are read in pages
const FILTERS: Record<string, { label: string; statuses: Enums<"inventory_status">[]; help: string }> = {
  vault: { label: "In vault", statuses: ["pawned", "extended"], help: "Items pledged for a loan that is still running (active, renewed, reinstated, or defaulted but not yet forfeited)." },
  forfeited: { label: "Forfeited", statuses: ["forfeited"], help: "An Admin forfeited the loan. The item is now shop property but is still physically in the vault." },
  auction: { label: "Queued for auction", statuses: ["queued_for_auction"], help: "Forfeited items put in an auction batch (Auction prep). Still in the vault until they are sold." },
  released: { label: "Released", statuses: ["redeemed"], help: "The loan was redeemed and the item was given back to the customer. It is no longer in the shop." },
  // #43 / UC16: sold at auction (recorded on Auction prep). No longer in the shop
  sold: { label: "Sold", statuses: ["sold"], help: "Forfeited items sold at auction (recorded on Auction prep, with the price and buyer). No longer in the shop." },
  all: { label: "All", statuses: [], help: "Every item ever pledged, in or out of the shop." },
};
const SORTS: Record<string, string> = { location: "vault_location", received: "created_at" }; // the sortable columns

type Row = {
  id: string;
  vault_location: string;
  status: InventoryStatus;
  created_at: string; // when the item came in (the loan was made)
  appraisal_items: { id: string; category: string; category_other: string | null; weight_grams: number; karat: number } | null;
  loans: {
    id: string;
    ticket_number: string;
    status: string;
    principal_balance: number;
    interest_owed: number;
    interest_rate_percent: number;
    maturity_date: string;
    interest_accrued_through: string | null;
    // LD (0073): liquidated damages, so owed amounts include them
    grace_period_days: number;
    liquidated_damages_percent: number;
    damages_owed: number;
    damages_accrued_through: string | null;
    customers: { id: string; full_name: string } | null;
  }[];
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; category?: string; loc?: string; q?: string; sort?: string; dir?: string }>;
}) {
  // all 4 roles can look; opening this page only READS data (it never changes an item or a loan)
  const user = await requireRole(["operator", "cashier", "appraiser", "admin"]);
  const params = await searchParams;
  const status = FILTERS[params.status ?? ""] ? params.status! : "vault";
  const page = pageParam(params.page);
  const isOperator = hasRole(user.profile.role, ["operator"]); // Physical audit and Auction prep (Admin always passes)
  const category = ITEM_CATEGORIES.some((c) => c.value === params.category) ? (params.category as Enums<"item_category">) : null;
  const q = params.q?.trim().slice(0, 60) || undefined;
  const sort = SORTS[params.sort ?? ""] ? params.sort! : "location";
  const dir = params.dir === "desc" ? "desc" : "asc";
  const today = manilaToday(); // the shop's date (Asia/Manila)

  const supabase = await createClient();

  // V1: the vault locations actually used (no location list exists yet, Matt #37), with how many items each has.
  // Read in pages of 1,000 so no location is missed. Nothing is renamed: "123" shows as it was typed.
  const locationCounts = new Map<string, number>();
  for (let from = 0; ; from += ROW_CHUNK) {
    const { data: locs, error: locError } = await supabase
      .from("inventory_items")
      .select("vault_location")
      .is("archived_at", null)
      .order("id")
      .range(from, from + ROW_CHUNK - 1);
    if (locError) throw locError;
    for (const l of locs ?? []) locationCounts.set(l.vault_location, (locationCounts.get(l.vault_location) ?? 0) + 1);
    if (!locs || locs.length < ROW_CHUNK) break;
  }
  const locations = [...locationCounts.entries()].sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true }));
  const loc = params.loc && locationCounts.has(params.loc) ? params.loc : null; // only a location that exists

  // V1: the search. Item words ("chain", "18k") become item filters; the rest is ticket, pawner (name or mobile) or location
  const parsed = q ? parseInventorySearch(q) : { category: null, karat: null, text: "" };
  const safe = parsed.text.replace(/[%,()*"\\]/g, " ").trim();
  let searchOr: string | null = null;
  if (safe) {
    // pawners by name, or mobile typed any way (0917 123 4567, +63 917...), same as Loans
    const ors = [`full_name.ilike.%${safe}%`];
    const digits = safe.replace(/\D/g, "");
    if (/^[+\d\s-]+$/.test(safe) && digits.length >= 4) {
      const local = digits.startsWith("63") && digits.length > 4 ? `0${digits.slice(2)}` : digits; // 63917... -> 0917...
      ors.push(`contact_number.ilike.%${local}%`);
    }
    const { data: people } = await supabase.from("customers").select("id").or(ors.join(",")).limit(200);
    const customerIds = (people ?? []).map((c) => c.id);
    // the loans with that ticket or of those pawners -> their items
    const { data: loanHits } = await supabase
      .from("loans")
      .select("inventory_item_id")
      .or(customerIds.length ? `ticket_number.ilike.%${safe}%,customer_id.in.(${customerIds.join(",")})` : `ticket_number.ilike.%${safe}%`)
      .not("inventory_item_id", "is", null)
      .limit(200);
    const itemIds = [...new Set((loanHits ?? []).map((l) => l.inventory_item_id as string))];
    // one "or": one of those items, or the location typed
    searchOr = itemIds.length ? `vault_location.ilike.%${safe}%,id.in.(${itemIds.join(",")})` : `vault_location.ilike.%${safe}%`;
  }

  // item filters: the Category dropdown, and item words typed in the search
  const itemFilter = Boolean(category || parsed.category || parsed.karat);
  type Filterable<T> = {
    in(column: "status", values: Enums<"inventory_status">[]): T;
    eq(column: string, value: string | number): T;
    or(filters: string): T;
  };
  const applyFilters = <T extends Filterable<T>>(query: T, statuses: Enums<"inventory_status">[], withSearch: boolean): T => {
    let r = query;
    if (statuses.length) r = r.in("status", statuses); // "All" has no status filter
    if (category) r = r.eq("appraisal_items.category", category);
    if (loc) r = r.eq("vault_location", loc);
    if (withSearch) {
      if (parsed.category) r = r.eq("appraisal_items.category", parsed.category);
      if (parsed.karat) r = r.eq("appraisal_items.karat", parsed.karat);
      if (searchOr) r = r.or(searchOr);
    }
    return r;
  };

  // the 10 items on this page. Sorted by the chosen column, then id, so no item shows on two pages
  const listQuery = applyFilters(
    supabase
      .from("inventory_items")
      .select(
        `id, vault_location, status, created_at, appraisal_items${itemFilter ? "!inner" : ""}(id, category, category_other, weight_grams, karat), loans(id, ticket_number, status, principal_balance, interest_owed, interest_rate_percent, maturity_date, interest_accrued_through, customers(id, full_name))`,
        { count: "exact" },
      )
      .is("archived_at", null),
    FILTERS[status].statuses,
    true,
  )
    .order(SORTS[sort], { ascending: dir === "asc" })
    .order("created_at") // same location -> the item that came in first, first
    .order("id") // then always the same order
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  // the tab counts: follow the Category and Vault location dropdowns, not the search (same as the other pages)
  const countFor = async (statuses: Enums<"inventory_status">[]) => {
    const { count: n } = await applyFilters(
      supabase
        .from("inventory_items")
        .select(`id, appraisal_items${category ? "!inner" : ""}(category)`, { count: "exact", head: true })
        .is("archived_at", null),
      statuses,
      false,
    );
    return n ?? 0; // a failed count shows 0 instead of breaking the page
  };

  const [{ data, count, error }, counts] = await Promise.all([listQuery, Promise.all(Object.values(FILTERS).map((f) => countFor(f.statuses)))]);
  const tabCount = Object.fromEntries(Object.keys(FILTERS).map((k, i) => [k, counts[i]])); // tab id -> count

  // links keep the tab, filters, search and sort
  const listParams = {
    status: status === "vault" ? undefined : status,
    category: category ?? undefined,
    loc: loc ?? undefined,
    q,
    sort: sort === "location" ? undefined : sort,
    dir: sort === "location" && dir === "asc" ? undefined : dir,
  };
  const href = (o: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...listParams, ...o })) if (v) qs.set(k, v);
    const s = qs.toString();
    return s ? `${BASE}?${s}` : BASE;
  };

  // a page past the end (old link, or a search made the list shorter): back to page 1 instead of the error page
  const pastEnd = error?.code === "PGRST103" && page > 1;
  if (error && !pastEnd) throw error;
  if (pastEnd || ((data?.length ?? 0) === 0 && (count ?? 0) > 0 && page > 1)) redirect(href({ page: undefined }));
  const items = (data ?? []) as unknown as Row[];

  // V1: the status history of the items on this page: when each got its current status, and the release time
  const historyById = new Map<string, ReturnType<typeof historySummary>>();
  if (items.length) {
    const { data: hist } = await supabase
      .from("inventory_status_history")
      .select("inventory_item_id, new_status, changed_at")
      .in("inventory_item_id", items.map((i) => i.id));
    const grouped = new Map<string, { new_status: string; changed_at: string }[]>();
    for (const h of hist ?? []) grouped.set(h.inventory_item_id, [...(grouped.get(h.inventory_item_id) ?? []), h]);
    for (const i of items) historyById.set(i.id, historySummary(grouped.get(i.id) ?? [], i.status));
  }

  // pieces used by both the table (computers) and the cards (phones)
  const linkClass = "rounded-sm underline-offset-2 hover:text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500";
  const itemCell = (i: Row) =>
    i.appraisal_items ? (
      // V1: the item opens its appraisal (photos, notes, who appraised it), so similar items can be told apart
      <Link href={`/dashboard/appraisals/${i.appraisal_items.id}`} className={`font-medium text-slate-900 ${linkClass}`}>
        {categoryLabel(i.appraisal_items.category, i.appraisal_items.category_other)}, {i.appraisal_items.karat}K, {i.appraisal_items.weight_grams} g
      </Link>
    ) : (
      <span className="text-slate-500">Item not found</span>
    );
  const pawner = (i: Row) => {
    const c = i.loans?.[0]?.customers;
    return c ? (
      <Link href={`/dashboard/customers/${c.id}`} className={linkClass}>
        {c.full_name}
      </Link>
    ) : (
      ""
    );
  };
  const loanCell = (i: Row) => {
    const l = i.loans?.[0];
    if (!l) return <span className="text-slate-500">No loan</span>;
    const state = stateBadge(l.status); // Active, Renewed, Reinstated, Defaulted, Forfeited, Redeemed
    const situation = situationBadge(l, today); // Paid, ready to release / Overdue / Due soon (running loans only)
    return (
      <>
        <span className="block whitespace-nowrap font-mono text-xs text-slate-700">{l.ticket_number}</span>
        <span className="mt-1 flex flex-wrap gap-1">
          <StatusBadge status={state.status} label={state.label} />
          {situation && <StatusBadge status={situation.status} label={situation.label} />}
        </span>
      </>
    );
  };
  const custodyCell = (i: Row) => {
    const c = CUSTODY[i.status] ?? { label: i.status, where: "", tone: "neutral" as const };
    const since = historyById.get(i.id)?.since; // when it got the status it has now
    return (
      <>
        {/* title = the full meaning when you point at it; the words are also in the help box */}
        <span title={c.where}>
          <Badge tone={c.tone}>{c.label}</Badge>
        </span>
        {/* forfeited and queued items are still physically in the vault; say so, so nobody thinks they're gone */}
        {(i.status === "forfeited" || i.status === "queued_for_auction") && <span className="block whitespace-nowrap text-xs font-medium text-slate-700">Still in vault</span>}
        {/* V1: when it got its current status, from the status history (before, this was the last time anything in the
            row changed, so it could show an unrelated date) */}
        {since && (
          <span className="block whitespace-nowrap text-xs text-slate-500">
            {CHANGE_WORDS[i.status] ?? i.status} {formatDate(manilaDateOf(since.changed_at))}
          </span>
        )}
      </>
    );
  };
  const received = (i: Row) => formatDate(manilaDateOf(i.created_at)); // the Manila day the item came in
  const held = (i: Row) => {
    // released or sold items stop counting on the day they left the shop (#43)
    const releasedAt = i.status === "redeemed" || i.status === "sold" ? historyById.get(i.id)?.releasedAt : null;
    const days = daysHeld(i.created_at, today, releasedAt);
    return (
      <>
        <span className="font-medium tabular-nums">{days}</span>
        {/* a released item stops counting on the day it went out */}
        {releasedAt && <span className="block whitespace-nowrap text-xs text-slate-500">until {i.status === "sold" ? "sold" : "released"}</span>}
      </>
    );
  };

  const viewing = [FILTERS[status].label, category ? categoryLabel(category, null) : null, loc].filter(Boolean).join(" · "); // e.g. "In vault · Chain · Safe 1"
  const empty = q
    ? { title: "No items match your search", description: "Try the full ticket number, the pawner's name or mobile, a vault location, or an item type and karat like \"chain 18k\"." }
    : { title: `No items ${FILTERS[status].label.toLowerCase()}`, description: category || loc ? "Try All categories or All locations." : undefined };

  return (
    <div>
      <PageHeader
        title="Vault inventory"
        description="Every pledged item, where it is stored, whether it is still in the shop, and its loan."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Inventory" }]}
        actions={
          isOperator && (
            <>
              <ButtonLink href="/dashboard/inventory/audit">Physical audit</ButtonLink>
              <ButtonLink href="/dashboard/inventory/auction">Auction prep</ButtonLink>
            </>
          )
        }
      />

      <Card padded={false}>
        {/* the status tabs with counts (same tab row as every page). Changing tab keeps the filters, goes back to page 1 */}
        <ViewTabs
          label="Inventory views"
          current={status}
          tabs={Object.entries(FILTERS).map(([value, f]) => ({
            value,
            label: f.label,
            count: tabCount[value],
            href: href({ status: value === "vault" ? undefined : value, page: undefined }),
          }))}
        />
        {/* V1: search + Category + Vault location on the left, "Viewing" or "N matches" on the right */}
        <ViewToolbar viewing={viewing} matches={q ? (count ?? 0) : undefined}>
          <div className="w-full sm:w-72">
            <InventorySearch defaultValue={q} keep={{ status: listParams.status, category: listParams.category, loc: listParams.loc, sort: listParams.sort, dir: listParams.dir }} />
          </div>
          <NavSelect
            label="Category"
            value={category ?? ""}
            options={[{ value: "", label: "All categories", href: href({ category: undefined, page: undefined }) }].concat(
              ITEM_CATEGORIES.map((c) => ({ value: c.value, label: c.label, href: href({ category: c.value, page: undefined }) })),
            )}
          />
          {/* V1: the locations in the data, with how many items each holds (all tabs) */}
          <NavSelect
            label="Vault location"
            value={loc ?? ""}
            options={[{ value: "", label: "All locations", href: href({ loc: undefined, page: undefined }) }].concat(
              locations.map(([name, n]) => ({ value: name, label: `${name} (${n.toLocaleString("en-PH")})`, href: href({ loc: name, page: undefined }) })),
            )}
          />
        </ViewToolbar>

        {items.length > 0 ? (
          <>
            {/* CARDS below 1100px (phones, tablets, big zoom), same break as Loans: nothing scrolls sideways */}
            <ul className="divide-y divide-slate-100 min-[1100px]:hidden">
              {items.map((i) => (
                <li key={i.id} className="px-4 py-3">
                  {/* line 1: item + pawner on the left, location on the right */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {itemCell(i)}
                      <span className="block text-sm text-slate-600">{pawner(i)}</span>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="block text-xs text-slate-500">Vault location</span>
                      <span className="font-semibold text-navy-900">{i.vault_location}</span>
                    </div>
                  </div>
                  {/* line 2: custody and the loan */}
                  <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                    <div>{custodyCell(i)}</div>
                    <div>{loanCell(i)}</div>
                  </div>
                  {/* line 3: dates and View loan */}
                  <div className="mt-2 flex items-center justify-between gap-3 text-sm text-slate-600">
                    <span>
                      Received {received(i)} · <span className="text-slate-900">{held(i)}</span> days held
                    </span>
                    {i.loans?.[0] && <ViewButton href={`/dashboard/loans/${i.loans[0].id}`}>View loan</ViewButton>}
                  </div>
                </li>
              ))}
            </ul>

            {/* COMPUTERS (1100px and wider): the table. No scroll box inside, so only the page scrolls */}
            <div className="hidden min-[1100px]:block">
              <Table minWidth="1000px" className="[&_thead]:bg-slate-100 [&_thead]:text-slate-700 [&_th]:font-semibold">
                <THead>
                  <SortTH label="Location" column="location" current={sort} dir={dir} basePath={BASE} params={listParams} />
                  <TH>Item</TH>
                  <TH>Pawner</TH>
                  <TH>Loan</TH>
                  <TH>Custody</TH>
                  <SortTH label="Received" column="received" current={sort} dir={dir} basePath={BASE} params={listParams} />
                  <TH align="right" className="whitespace-nowrap">Days held</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </THead>
                <TBody>
                  {items.map((i) => (
                    <TR key={i.id}>
                      <TD className="whitespace-nowrap font-medium">{i.vault_location}</TD>
                      <TD>{itemCell(i)}</TD>
                      <TD>{pawner(i)}</TD>
                      <TD>{loanCell(i)}</TD>
                      <TD>{custodyCell(i)}</TD>
                      <TD className="whitespace-nowrap">{received(i)}</TD>
                      <TD align="right">{held(i)}</TD>
                      <TD align="right">{i.loans?.[0] && <ViewButton href={`/dashboard/loans/${i.loans[0].id}`}>View loan</ViewButton>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath={BASE} params={listParams} />
          </>
        ) : (
          <EmptyState title={empty.title} description={empty.description} />
        )}

        {/* V1: what the statuses mean, folded away (same box as Loans and Customers) */}
        <details className="border-t border-slate-200 px-4 py-2.5 text-sm text-slate-600">
          <summary className="cursor-pointer rounded font-medium text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
            What do the inventory statuses mean?
          </summary>
          <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.values(FILTERS).map((f) => (
              <div key={f.label}>
                <dt className="font-semibold text-slate-800">{f.label}</dt>
                <dd>{f.help}</dd>
              </div>
            ))}
            <div>
              <dt className="font-semibold text-slate-800">Custody vs Loan</dt>
              <dd>
                <strong>Custody</strong> says where the physical item is. <strong>Loan</strong> shows the loan&apos;s own status, like on the Loans page.
                A Defaulted loan&apos;s item stays In vault until an Admin forfeits it; &quot;Paid, ready to release&quot; means the loan owes ₱0 and the
                item is waiting to be handed back.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Received and Days held</dt>
              <dd>
                Received is the day the item came in (the day the loan was made). Days held counts calendar days from then; for a released item it stops
                on the release day. Renewing doesn&apos;t restart it. The small date under Custody is when the item got its current status (e.g. Renewed Oct 12).
              </dd>
            </div>
          </dl>
        </details>
      </Card>
    </div>
  );
}
