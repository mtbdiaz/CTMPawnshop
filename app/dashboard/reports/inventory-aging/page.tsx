import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { appraisalNo, customerNo } from "@/lib/ref-numbers";
import { CUSTODY } from "@/lib/inventory/custody"; // the Inventory page's own labels and colours
import { ReportHeader } from "@/components/report-header";
import { Badge, Card, EmptyState, Table, TBody, TD, TH, THead, TR, ActionsCell, ViewButton, buttonClasses, cx, pageParam } from "@/components/ui";
import { AGE_BANDS, INVENTORY_SORTS, PRINT_LIMIT, reportData, type AgeBand, type CustodyGroup, type InventorySort, type ReportInventory } from "@/lib/reports/report-utils";
import { PrintScope, ShowAllLink, reportHref } from "../report-parts";
import { ReportPagination } from "../report-pagination"; // IA7: the same paging as the other reports

export const metadata = { title: "Inventory aging report" };

const BASE = "/dashboard/reports/inventory-aging";
const PAGE_SIZE = 10; // IA7 (Nov 13): 10 per page like the other reports (was 50)
const AGED_DAYS = 60; // "held over 60 days" (the database counts the same: aged_count)
const BANDS = Object.keys(AGE_BANDS) as AgeBand[];

// the Inventory page's tabs for items still in the shop (Released and Sold are not in the shop any more)
const CUSTODY_GROUPS: Record<CustodyGroup, string> = { vault: "In vault", forfeited: "Forfeited", auction: "Queued for auction" };
type StatusView = CustodyGroup | "followup";

// IA5 (Nov 13): age shown calmly: 0–60 days plain, 61–90 amber words, over 90 an amber pill. No red: being old is not
// a problem by itself (there is no business rule that makes an old item urgent).
const BAND_BAR: Record<AgeBand, string> = { "0_30": "border-l-slate-300", "31_60": "border-l-slate-300", "61_90": "border-l-amber-300", over_90: "border-l-amber-500" };

// RP5 (Nov 12): Inventory aging: Inventory's own rules (In vault / Forfeited / Queued for auction, Days held in Manila
// calendar days from the day the item came in), age groups with counts. RP9: worked out by the database
// (report_inventory_aging, migration 0066). This report only reads: it never moves, sells or changes an item.
// IA1–IA8 (Nov 13, after the Inventory aging review, same patterns as Outstanding and Overdue loans):
// - a compact summary of everything in the shop (items, held over 60 days, the four age groups);
// - one filter row: search (A-number, ticket, customer, C-number, category, vault), status (incl. Audit follow-up),
//   vault location, days held, sort (default oldest first); search, vault and sort are done by the database (0070);
// - the table: no yellow rows; item first with its A-number (links to the appraisal), vault location and status kept
//   apart (a queued item is still in the vault), the customer links to their page, View loan, an "Audit follow-up"
//   badge for items with an unresolved physical-audit finding (the Physical audit page's own rule);
// - 10 per page with page numbers and Go to page; printouts state the scope and keep each item on one line;
// - "About inventory aging" at the bottom.
export default async function InventoryAgingReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  // "custody" was the old name of this filter in the address; still understood so old links keep working
  const statusParam = sp.status ?? sp.custody;
  const status = (statusParam && (statusParam in CUSTODY_GROUPS || statusParam === "followup") ? statusParam : "") as StatusView | "";
  const vault = (sp.vault ?? "").trim().slice(0, 120);
  const band = (sp.age && sp.age in AGE_BANDS ? sp.age : "") as AgeBand | "";
  const sort = (sp.sort && sp.sort in INVENTORY_SORTS ? sp.sort : "oldest") as InventorySort;
  const all = sp.all === "1"; // up to 1,000 rows on one page (for printing)

  const supabase = await createClient();
  const r = reportData<ReportInventory>(
    await supabase.rpc("report_inventory_aging", {
      p_custody: status && status !== "followup" ? status : undefined,
      p_followup: status === "followup" ? true : undefined,
      p_band: band || undefined,
      p_q: q || undefined,
      p_vault: vault || undefined,
      p_sort: sort === "oldest" ? undefined : sort,
      p_page: pageParam(sp.page),
      p_size: all ? PRINT_LIMIT : PAGE_SIZE,
    }),
  );
  const today = r.today;
  const bandCount = (b: AgeBand) => Number((r.all_band_counts ?? r.band_counts)?.[b] ?? 0); // everything in the shop
  const groupCount = (g: CustodyGroup) => Number(r.custody_counts?.[g] ?? 0);
  const followups = Number(r.followup_count ?? 0);
  const vaults = r.vaults ?? [];

  const current = { q: q || undefined, status: status || undefined, vault: vault || undefined, age: band || undefined, sort: sort === "oldest" ? undefined : sort };
  const filtered = Boolean(q || status || vault || band);
  const statusName = (s: StatusView) => (s === "followup" ? "Audit follow-up" : CUSTODY_GROUPS[s]);
  // the scope in words, used by the list line and the printout
  const scope = [
    status ? statusName(status) : "All items in the shop",
    vault ? `vault "${vault}"` : "",
    band ? `held ${AGE_BANDS[band].toLowerCase()}` : "", // "held over 90 days"
    q ? `search "${q}"` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const field = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20";

  return (
    <div>
      <ReportHeader
        title="Inventory aging"
        description="Track items currently held in the shop, their storage locations, inventory status and number of days held."
        subtitle={`As of ${formatDate(today)} · ${scope}${sort !== "oldest" ? ` · sorted by ${INVENTORY_SORTS[sort].charAt(0).toLowerCase()}${INVENTORY_SORTS[sort].slice(1)}` : ""}`} // "sorted by vault location (A to Z)"
      />

      {/* IA2: a compact overview of everything in the shop (not only the list below), from the database */}
      <section aria-labelledby="ia-summary" className="mb-4 break-inside-avoid">
        <h2 id="ia-summary" className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          All items in the shop · as of {formatDate(today)}
        </h2>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-md border border-navy-200 bg-navy-50 px-3 py-2">
            <dt className="text-xs font-medium text-slate-600">Items in the shop</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-navy-900">{r.all_count.toLocaleString("en-PH")}</dd>
          </div>
          <div className="rounded-md border border-l-4 border-slate-200 border-l-amber-400 bg-white px-3 py-2">
            <dt className="text-xs font-medium text-slate-600">Held over {AGED_DAYS} days</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">{r.aged_count.toLocaleString("en-PH")}</dd>
          </div>
          {BANDS.map((b) => (
            <div key={b} className={cx("rounded-md border border-l-4 border-slate-200 bg-white px-3 py-2", BAND_BAR[b])}>
              <dt className="text-xs font-medium text-slate-600">{AGE_BANDS[b]}</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">{bandCount(b).toLocaleString("en-PH")}</dd>
            </div>
          ))}
        </dl>
        {/* IA6: verified problems only: unresolved physical-audit findings (never "old = missing") */}
        {followups > 0 && (
          <p className="mt-2 text-xs text-slate-700">
            <Badge tone="alert">Audit follow-up</Badge>{" "}
            {followups} item{followups === 1 ? " has" : "s have"} an unresolved physical-audit finding (not located or found elsewhere).{" "}
            <span className="print:hidden">
              <Link href="/dashboard/inventory/audit" className="font-medium text-navy-700 hover:underline">
                Review on Physical audit
              </Link>{" "}
              or pick Status → Audit follow-up.
            </span>
          </p>
        )}
      </section>

      <Card padded={false}>
        {/* IA3: one filter row like the other reports; everything is in the address, so paging and Back keep it */}
        <form action={BASE} className="space-y-3 border-b border-slate-200 p-4 print:hidden">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(13rem,2fr)_repeat(4,minmax(9rem,1fr))]">
            <div className="sm:col-span-2 xl:col-span-1">
              <label htmlFor="q" className="block text-xs font-medium text-slate-600">
                Search
              </label>
              <input id="q" name="q" type="search" defaultValue={q} placeholder="A-number, ticket, customer, C-number, item" className={field} />
            </div>
            <div>
              <label htmlFor="status" className="block text-xs font-medium text-slate-600">
                Status
              </label>
              <select id="status" name="status" defaultValue={status} className={field}>
                <option value="">All in the shop ({r.all_count})</option>
                {(Object.keys(CUSTODY_GROUPS) as CustodyGroup[]).map((g) => (
                  <option key={g} value={g}>
                    {CUSTODY_GROUPS[g]} ({groupCount(g)})
                  </option>
                ))}
                <option value="followup">Audit follow-up ({followups})</option>
              </select>
            </div>
            <div>
              <label htmlFor="vault" className="block text-xs font-medium text-slate-600">
                Vault location
              </label>
              <select id="vault" name="vault" defaultValue={vault} className={field}>
                <option value="">All locations</option>
                {vaults.map((v) => (
                  <option key={v.vault} value={v.vault}>
                    {v.vault} ({v.n})
                  </option>
                ))}
                {/* a location from an old link that no item uses any more still shows as picked */}
                {vault && !vaults.some((v) => v.vault === vault) && <option value={vault}>{vault} (0)</option>}
              </select>
            </div>
            <div>
              <label htmlFor="age" className="block text-xs font-medium text-slate-600">
                Days held
              </label>
              <select id="age" name="age" defaultValue={band} className={field}>
                <option value="">Any</option>
                {BANDS.map((b) => (
                  <option key={b} value={b}>
                    {AGE_BANDS[b]} ({bandCount(b)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sort" className="block text-xs font-medium text-slate-600">
                Sort by
              </label>
              <select id="sort" name="sort" defaultValue={sort} className={field}>
                {(Object.keys(INVENTORY_SORTS) as InventorySort[]).map((k) => (
                  <option key={k} value={k}>
                    {INVENTORY_SORTS[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {(filtered || sort !== "oldest") && (
              <Link href={BASE} className={buttonClasses("ghost")}>
                Clear filters
              </Link>
            )}
            <button type="submit" className={buttonClasses("primary")}>
              Apply filters
            </button>
          </div>
        </form>

        {/* what the list covers (also printed: this report has no money totals row) */}
        <p className="border-b border-slate-200 px-4 py-2 text-sm text-slate-600" aria-live="polite">
          <span className="font-medium text-slate-900">{r.total.toLocaleString("en-PH")}</span> item{r.total === 1 ? "" : "s"} · {scope}
          {sort !== "oldest" ? ` · ${INVENTORY_SORTS[sort]}` : ""}
        </p>

        {r.total ? (
          <>
            <PrintScope page={r.page} size={r.size} total={r.total} shown={r.rows.length} all={all} totalRow={false} />
            {/* on paper an item's row is never split across two pages; 8px cell padding like the loan reports, so the
                whole table fits a 1366 screen even at 125% and 150% zoom */}
            <Table minWidth="760px" className="print:[&_tr]:break-inside-avoid [&_td]:px-2 [&_th]:px-2">
              <THead>
                <TH>Item</TH>
                <TH>Vault location</TH>
                <TH>Customer</TH>
                <TH>Status</TH>
                <TH>Received</TH>
                <TH align="right">Days held</TH>
                {/* RP13: "relative" keeps the hidden "Actions" label inside the table's scroll box (no sideways page scroll) */}
                <TH className="relative print:hidden">
                  <span className="sr-only">Actions</span>
                </TH>
              </THead>
              <TBody>
                {r.rows.map((item) => {
                  const custody = CUSTODY[item.status];
                  return (
                    // IA5: no yellow row colour any more (was every row over 60 days)
                    <TR key={item.id}>
                      <TD>
                        <span className="font-medium text-slate-900">{item.category ? `${categoryLabel(item.category, item.category_other)}, ${item.karat}K, ${item.weight_grams} g` : "Item"}</span>
                        {/* IA4: the A-number opens the appraisal (photos, condition, value) */}
                        {item.appraisal_no ? (
                          item.appraisal_item_id ? (
                            <Link href={`/dashboard/appraisals/${item.appraisal_item_id}`} className="block w-fit font-mono text-xs text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
                              {appraisalNo(item.appraisal_no)}
                            </Link>
                          ) : (
                            <span className="block font-mono text-xs text-slate-500">{appraisalNo(item.appraisal_no)}</span>
                          )
                        ) : null}
                      </TD>
                      {/* where the item physically is, exactly as recorded (kept apart from its status) */}
                      <TD className="font-medium">{item.vault_location}</TD>
                      <TD>
                        {item.customer_id ? (
                          <Link href={`/dashboard/customers/${item.customer_id}`} className="text-slate-900 hover:text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
                            {item.customer_name ?? ""}
                          </Link>
                        ) : (
                          <span>{item.customer_name ?? ""}</span>
                        )}
                        {item.customer_no ? <span className="block font-mono text-xs text-slate-500">{customerNo(item.customer_no)}</span> : null}
                      </TD>
                      <TD>
                        <span className="flex flex-wrap gap-1">
                          <Badge tone={custody.tone}>{custody.label}</Badge>
                          {item.followup && <Badge tone="alert">Audit follow-up</Badge>}
                        </span>
                      </TD>
                      <TD className="whitespace-nowrap">{formatDate(item.received)}</TD>
                      <TD align="right" className="tabular-nums">
                        {item.days > 90 ? (
                          <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-900 ring-1 ring-inset ring-amber-400">{item.days}</span>
                        ) : (
                          <span className={item.days > AGED_DAYS ? "font-semibold text-amber-800" : undefined}>{item.days}</span>
                        )}
                      </TD>
                      <ActionsCell>{item.loan_id && <ViewButton href={`/dashboard/loans/${item.loan_id}`}>View loan</ViewButton>}</ActionsCell>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <ReportPagination page={r.page} pageSize={r.size} total={r.total} params={{ ...current, all: all ? "1" : undefined }} basePath={BASE} label="Inventory aging pages" />
            <ShowAllLink all={all} total={r.total} href={reportHref(BASE, current, { all: all ? undefined : "1" })} pageSize={PAGE_SIZE} />
          </>
        ) : (
          <EmptyState
            icon="vault"
            title={filtered ? "No item matches these filters" : "The vault is empty"}
            description={filtered ? "Try All in the shop, All locations, Any in Days held, or Clear filters." : undefined}
          />
        )}
      </Card>

      {/* IA8: what the report counts, in plain words (closed until asked for, not printed) */}
      <details className="mt-4 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 print:hidden">
        <summary className="cursor-pointer font-medium text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
          About inventory aging and days held
        </summary>
        <div className="mt-3 space-y-2">
          <p>
            <strong>Days held</strong> are Manila calendar days from the day the item came into the shop (the day the loan was made), the same count
            as the Inventory page. Renewing the loan, forfeiting the item or queuing it for auction does not restart the count.
          </p>
          <p>
            <strong>Status</strong> is where the item stands, not where it is kept: <strong>In vault</strong> = pledged for a running loan (including a
            renewed one); <strong>Forfeited</strong> = now shop property, still in the vault; <strong>Queued for auction</strong> = still in the vault
            until it is sold. The <strong>Vault location</strong> column is where it is kept.
          </p>
          <p>
            <strong>Audit follow-up</strong> = the last physical audit could not find the item where it should be (not located or found elsewhere) and
            nobody has closed the finding yet. Old items are not treated as missing.
          </p>
          <p className="text-xs text-slate-600">Not on this report: Released items (given back to the customer) and Sold items.</p>
        </div>
      </details>
    </div>
  );
}
