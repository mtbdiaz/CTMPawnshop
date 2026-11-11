import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatPeso } from "@/lib/format";
import { batchNo, batchStatus, type AuctionLinePage, type PrepareItem } from "@/lib/inventory/auction"; // AP1: the auction rules and words
import { Badge, Card, EmptyState, PageHeader, Pagination, SearchBar, pageParam } from "@/components/ui";
import { ViewTabs, ViewToolbar } from "@/components/view-tabs"; // the same tabs as Loans and Inventory
import { NavSelect } from "@/components/nav-select"; // a dropdown that opens a page (the batch filter)
import { AuctionForm } from "./auction-form";
import { LineRow } from "./line-row";

export const metadata = { title: "Auction prep" };

const PAGE_SIZE = 10; // rows per page, same as the other lists
const BASE = "/dashboard/inventory/auction";

// AP1 (Nov 12, migration 0052): the tabs. Each one is one job, so the page is no longer four long lists under each other.
const TABS = {
  prepare: { label: "Prepare items", help: "Forfeited items that are not in a batch. Tick the ones that passed the system checks, set each reserve price, review, then create the batch." },
  queued: { label: "Queued items", help: "Items in a batch, waiting to be sold. Record the sale here, or mark the item unsold if it did not sell." },
  batches: { label: "Auction batches", help: "Every batch that was made, with how many of its items are sold, unsold or still waiting. Open one to see its items." },
  sales: { label: "Sales history", help: "Every sale that was recorded: the price, the buyer, who recorded it and when. Sales can't be edited here." },
} as const;
type Tab = keyof typeof TABS;
const tabOf = (v: string | undefined): Tab => (v && v in TABS ? (v as Tab) : "prepare");

// Matt's flow is unchanged: forfeited item -> auction batch -> queued -> sale recorded -> sold (+ money in the cash ledger).
// Before: four sections stacked on one long page (forfeited, 53 queued, recent sales, recent batches).
// Now: a small summary, then one tab per job, each with search and 10 rows per page.
export default async function AuctionPrepPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; batch?: string; page?: string }> }) {
  const user = await requireRole(["operator", "admin"]);
  const isAdmin = user.profile.role === "admin"; // only an Admin can change a reserve that is already set
  const sp = await searchParams;
  const tab = tabOf(sp.tab);
  const q = (sp.q ?? "").trim().slice(0, 80);
  const page = pageParam(sp.page);
  const batchFilter = /^[0-9a-f-]{36}$/i.test(sp.batch ?? "") ? (sp.batch as string) : undefined;
  const supabase = await createClient();

  // The summary numbers, straight from the database. Each item has ONE custody status, so nothing is counted twice.
  const [forfeited, queued, sold, batchCount, notSet, proceeds] = await Promise.all([
    supabase.from("inventory_items").select("id", { count: "exact", head: true }).eq("status", "forfeited").is("archived_at", null),
    supabase.from("inventory_items").select("id", { count: "exact", head: true }).eq("status", "queued_for_auction").is("archived_at", null),
    supabase.from("inventory_items").select("id", { count: "exact", head: true }).eq("status", "sold").is("archived_at", null),
    supabase.from("auction_batches").select("id", { count: "exact", head: true }).is("archived_at", null),
    // queued items whose reserve nobody decided yet (they can't be sold until someone does)
    supabase
      .from("auction_batch_items")
      .select("id, auction_batches!inner(archived_at), inventory_items!inner(status)", { count: "exact", head: true })
      .is("sold_at", null)
      .is("unsold_at", null)
      .is("min_price", null)
      .eq("no_reserve", false)
      .is("auction_batches.archived_at", null)
      .eq("inventory_items.status", "queued_for_auction"),
    // the total of every recorded sale (size 5 = the smallest page; only the total is used here)
    supabase.rpc("auction_lines", { p_kind: "sold", p_size: 5 }),
  ]);
  const counts = { prepare: forfeited.count ?? 0, queued: queued.count ?? 0, batches: batchCount.count ?? 0, sales: sold.count ?? 0 };
  const proceedsTotal = Number((proceeds.data as unknown as AuctionLinePage | null)?.sum ?? 0);
  const reserveNotSet = notSet.count ?? 0;

  // the address of a tab, keeping nothing from the other tabs (each tab has its own search)
  const tabHref = (t: Tab) => (t === "prepare" ? BASE : `${BASE}?tab=${t}`);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Auction prep"
        description="Put forfeited items in a batch with a reserve price, then record what happened to each one at the auction."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Inventory", href: "/dashboard/inventory" }, { label: "Auction prep" }]}
      />

      {/* the summary: three small numbers in one row, also on a phone (not big dashboard cards). Each one opens its tab */}
      <dl className="grid grid-cols-3 divide-x divide-slate-200 rounded-md border border-slate-200 bg-white text-sm">
        <Stat href={tabHref("prepare")} label="Forfeited" value={counts.prepare} note={counts.prepare ? "to prepare for a batch" : "nothing to prepare"} />
        <Stat
          href={tabHref("queued")}
          label="Queued"
          value={counts.queued}
          note={reserveNotSet > 0 ? `${reserveNotSet} with reserve not set` : counts.queued ? "waiting for the auction" : "nothing queued"}
          warn={reserveNotSet > 0}
        />
        <Stat href={tabHref("sales")} label="Recorded sales" value={counts.sales} note={counts.sales ? `${formatPeso(proceedsTotal)} in total` : "no sales yet"} />
      </dl>

      <Card padded={false}>
        <ViewTabs
          label="Auction prep views"
          current={tab}
          tabs={(Object.keys(TABS) as Tab[]).map((t) => ({ value: t, label: TABS[t].label, href: tabHref(t), count: counts[t] }))}
        />

        {tab === "prepare" && <PrepareTab />}
        {tab === "queued" && <QueuedTab q={q} page={page} batch={batchFilter} isAdmin={isAdmin} />}
        {tab === "batches" && <BatchesTab q={q} page={page} />}
        {tab === "sales" && <SalesTab q={q} page={page} isAdmin={isAdmin} />}

        {/* what the words mean, closed by default (the same fold-out box as Loans and Customers) */}
        <details className="border-t border-slate-200 px-4 py-2.5 text-sm text-slate-600">
          <summary className="cursor-pointer rounded font-medium text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
            What do auction statuses and reserve prices mean?
          </summary>
          <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(TABS) as Tab[]).map((t) => (
              <div key={t}>
                <dt className="font-semibold text-slate-800">{TABS[t].label}</dt>
                <dd>{TABS[t].help}</dd>
              </div>
            ))}
            <div>
              <dt className="font-semibold text-slate-800">Forfeited</dt>
              <dd>An Admin forfeited the loan. The item is shop property and stays in the vault. Only these can go in a batch.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Queued</dt>
              <dd>In a batch, waiting for the auction. Still in the vault and still counted in a physical audit.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Sold</dt>
              <dd>
                The sale was recorded: the buyer paid in full, took the item, and the money is in the cash ledger. There is no &ldquo;paid, not released yet&rdquo; state, so
                record a sale only when both happened. It can&apos;t be undone here.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Not sold</dt>
              <dd>It did not sell in that batch. It went back to Forfeited and can go in a later batch. The old batch keeps the record.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">System checks passed</dt>
              <dd>Forfeited by an Admin, records complete, not in another batch, no open audit problem. It is not a legal approval: notice and publication are not checked here.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Reserve price</dt>
              <dd>The lowest amount the item may be sold for. A sale below it is refused.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">No reserve</dt>
              <dd>Someone chose on purpose that the item may be sold at any price.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Not set</dt>
              <dd>Nobody decided the reserve yet (items queued before this update). Set it before the item can be sold.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Ledger already has a sale</dt>
              <dd>The cash ledger has auction money for that ticket but the item is still queued. An Admin has to check it; a sale is refused until then.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Blocked: not located</dt>
              <dd>The last physical audit could not find the item. Follow it up on the Physical audit page first.</dd>
            </div>
          </dl>
          <p className="mt-3">
            <span className="font-semibold text-slate-800">Not in this system:</span> the notice to the customer and the public notice of the auction. Make sure those were
            done before the auction; this page can&apos;t check them.
          </p>
        </details>
      </Card>
    </div>
  );
}

// one number of the summary row; the whole cell is a link to its tab
function Stat({ href, label, value, note, warn }: { href: string; label: string; value: number; note: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <Link href={href} className="block px-3 py-2 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-500 sm:px-4">
        <dt className="text-xs text-slate-600">{label}</dt>
        <dd>
          <span className="text-lg font-semibold tabular-nums leading-tight text-slate-900">{value.toLocaleString("en-PH")}</span>
          {/* amber + the words "not set" = needs attention (the color is never the only signal) */}
          <span className={warn ? "block text-xs font-medium text-amber-800" : "block text-xs text-slate-500"}>{note}</span>
        </dd>
      </Link>
    </div>
  );
}

// ---------- tab 1: forfeited items -> a batch ----------
async function PrepareTab() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("auction_prepare_list"); // each item with whether it can go in a batch
  if (error) throw error;
  const items = (data as unknown as PrepareItem[] | null) ?? [];
  return (
    <div className="px-4 py-4">
      {items.length ? (
        <AuctionForm items={items} />
      ) : (
        <EmptyState icon="gavel" title="No forfeited items waiting" description="Items appear here after an Admin forfeits a defaulted loan, or when a queued item is marked unsold." />
      )}
    </div>
  );
}

// ---------- tab 2: queued items -> record sale / mark unsold ----------
async function QueuedTab({ q, page, batch, isAdmin }: { q: string; page: number; batch?: string; isAdmin: boolean }) {
  const supabase = await createClient();
  const [{ data, error }, { data: batches }] = await Promise.all([
    supabase.rpc("auction_lines", { p_kind: "queued", p_q: q || undefined, p_batch: batch, p_page: page, p_size: PAGE_SIZE }),
    supabase.from("auction_batches").select("id, batch_no, created_at").is("archived_at", null).order("batch_no", { ascending: false }).limit(200),
  ]);
  if (error) throw error;
  const res = data as unknown as AuctionLinePage;
  const href = (b?: string) => {
    const p = new URLSearchParams({ tab: "queued" });
    if (q) p.set("q", q);
    if (b) p.set("batch", b);
    return `${BASE}?${p}`;
  };
  return (
    <>
      <ViewToolbar viewing="Queued items" matches={q || batch ? res.total : undefined}>
        <SearchBar action={BASE} defaultValue={q} placeholder="Search ticket, A-number, item, customer" hidden={{ tab: "queued", batch }} />
        <NavSelect
          label="Batch"
          value={batch ?? ""}
          options={[{ value: "", label: "All batches", href: href() }, ...(batches ?? []).map((b) => ({ value: b.id, label: `${batchNo(b.batch_no)} · ${formatDate(b.created_at)}`, href: href(b.id) }))]}
        />
        {(q || batch) && (
          <Link href={`${BASE}?tab=queued`} className="text-sm font-medium text-navy-700 hover:underline">
            Clear
          </Link>
        )}
      </ViewToolbar>
      {res.rows.length ? (
        <>
          <ul className="divide-y divide-slate-100">
            {res.rows.map((l) => (
              <LineRow key={l.id} line={l} isAdmin={isAdmin} />
            ))}
          </ul>
          <Pagination page={res.page} pageSize={PAGE_SIZE} total={res.total} basePath={BASE} params={{ tab: "queued", q: q || undefined, batch }} />
        </>
      ) : q || batch ? (
        <EmptyState icon="gavel" title="No queued item matches" description="Try the ticket number, the A-number, the item type or the customer's name." />
      ) : (
        <EmptyState icon="gavel" title="Nothing queued for auction" description="Create a batch under Prepare items. Its items show here until each one is sold or marked unsold." />
      )}
    </>
  );
}

// ---------- tab 3: the batches ----------
async function BatchesTab({ q, page }: { q: string; page: number }) {
  const supabase = await createClient();
  let query = supabase
    .from("auction_batches")
    .select("id, batch_no, created_at, notes, auction_date, auction_place, profiles!auction_batches_created_by_fkey(full_name), auction_batch_items(sold_at, unsold_at, sale_price)", { count: "exact" })
    .is("archived_at", null);
  // search: "AB-0007" or "7" finds the batch number; other words look in the notes and the place
  const num = q.match(/^(?:ab[\s-]?)?0*(\d{1,6})$/i);
  if (num) query = query.eq("batch_no", Number(num[1]));
  else if (q) {
    const like = `%${q.replace(/[%_,()\\]/g, " ")}%`; // typed symbols can't change the search
    query = query.or(`notes.ilike.${like},auction_place.ilike.${like}`);
  }
  const { data, count, error } = await query.order("batch_no", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw error;
  type Row = {
    id: string;
    batch_no: number;
    created_at: string;
    notes: string | null;
    auction_date: string | null;
    auction_place: string | null;
    profiles: { full_name: string } | null;
    auction_batch_items: { sold_at: string | null; unsold_at: string | null; sale_price: number | null }[];
  };
  const rows = (data ?? []) as unknown as Row[];
  return (
    <>
      <ViewToolbar viewing="Auction batches" matches={q ? (count ?? 0) : undefined}>
        <SearchBar action={BASE} defaultValue={q} placeholder="Search batch number, notes or place" hidden={{ tab: "batches" }} />
        {q && (
          <Link href={`${BASE}?tab=batches`} className="text-sm font-medium text-navy-700 hover:underline">
            Clear
          </Link>
        )}
      </ViewToolbar>
      {rows.length ? (
        <>
          <ul className="divide-y divide-slate-100">
            {rows.map((b) => {
              const lines = b.auction_batch_items;
              const soldLines = lines.filter((l) => l.sold_at);
              const c = { items: lines.length, sold: soldLines.length, unsold: lines.filter((l) => l.unsold_at).length };
              const status = batchStatus(c);
              return (
                <li key={b.id}>
                  {/* the whole row opens the batch */}
                  <Link href={`${BASE}/batch/${b.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-500">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                        <span className="font-mono">{batchNo(b.batch_no)}</span>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </span>
                      <span className="block text-xs text-slate-600">
                        Created {formatDateTime(b.created_at)} by {b.profiles?.full_name ?? "staff"}
                        {b.auction_date ? ` · auction ${formatDate(b.auction_date)}` : ""}
                        {b.auction_place ? ` · ${b.auction_place}` : ""}
                      </span>
                      {b.notes && <span className="block break-words text-xs text-slate-500">{b.notes}</span>}
                    </span>
                    <span className="text-right text-slate-700">
                      {c.items} item{c.items === 1 ? "" : "s"} · {c.sold} sold · {c.unsold} not sold · {c.items - c.sold - c.unsold} waiting
                      {c.sold > 0 && <span className="block text-xs tabular-nums">{formatPeso(soldLines.reduce((t, l) => t + Number(l.sale_price ?? 0), 0))} from sales</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath={BASE} params={{ tab: "batches", q: q || undefined }} />
        </>
      ) : q ? (
        <EmptyState icon="gavel" title="No batch matches" description="Try the batch number (AB-0007) or a word from its notes." />
      ) : (
        <EmptyState icon="gavel" title="No auction batches yet" description="Create one under Prepare items." />
      )}
    </>
  );
}

// ---------- tab 4: the sales ----------
async function SalesTab({ q, page, isAdmin }: { q: string; page: number; isAdmin: boolean }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("auction_lines", { p_kind: "sold", p_q: q || undefined, p_page: page, p_size: PAGE_SIZE });
  if (error) throw error;
  const res = data as unknown as AuctionLinePage;
  return (
    <>
      <ViewToolbar viewing="Sales history" matches={q ? res.total : undefined}>
        <SearchBar action={BASE} defaultValue={q} placeholder="Search ticket, A-number, item, buyer, batch" hidden={{ tab: "sales" }} />
        {q && (
          <Link href={`${BASE}?tab=sales`} className="text-sm font-medium text-navy-700 hover:underline">
            Clear
          </Link>
        )}
      </ViewToolbar>
      {res.rows.length ? (
        <>
          <p className="border-b border-slate-100 px-4 py-2 text-sm text-slate-600">
            {res.total} sale{res.total === 1 ? "" : "s"}
            {q ? " found" : ""} · <span className="font-medium tabular-nums text-slate-900">{formatPeso(Number(res.sum))}</span> in total. Newest first.
          </p>
          <ul className="divide-y divide-slate-100">
            {res.rows.map((l) => (
              <LineRow key={l.id} line={l} isAdmin={isAdmin} />
            ))}
          </ul>
          <Pagination page={res.page} pageSize={PAGE_SIZE} total={res.total} basePath={BASE} params={{ tab: "sales", q: q || undefined }} />
        </>
      ) : q ? (
        <EmptyState icon="gavel" title="No sale matches" description="Try the ticket number, the A-number, the buyer's name or the batch number." />
      ) : (
        <EmptyState icon="gavel" title="No sales recorded yet" description="A sale shows here after it is recorded under Queued items." />
      )}
    </>
  );
}
