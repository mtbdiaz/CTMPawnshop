import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { appraisalNo } from "@/lib/ref-numbers";
import { CUSTODY } from "@/lib/inventory/custody"; // the Inventory page's own labels and colours
import { ReportHeader } from "@/components/report-header";
import { Badge, Card, EmptyState, Pagination, Table, TBody, TD, TH, THead, TR, pageParam } from "@/components/ui";
import { ViewToolbar } from "@/components/view-tabs";
import { NavSelect } from "@/components/nav-select";
import { AGE_BANDS, reportData, type AgeBand, type CustodyGroup, type ReportInventory } from "@/lib/reports/report-utils";
import { PrintScope, ShowAllLink, pageSizeFor, reportHref } from "../report-parts";

export const metadata = { title: "Inventory aging report" };

const BASE = "/dashboard/reports/inventory-aging";
const AGED_DAYS = 60; // over this many days held is highlighted (the database counts the same: aged_count)

// the Inventory page's tabs for items still in the shop (Released and Sold are not in the shop any more)
const CUSTODY_GROUPS: Record<CustodyGroup, string> = { vault: "In vault", forfeited: "Forfeited", auction: "Queued for auction" };

// RP5 (Nov 12): Inventory aging.
// Before: days were counted from the exact time in UTC, so an item could be a day younger here than on the
// Inventory page, and the badge said "Pawned" where Inventory says "In vault".
// Now: Inventory's own rules (In vault / Forfeited / Queued for auction, Days held in Manila calendar days from
// the day the item came in), age groups with counts, filters, 50 rows a page.
// RP9 (Nov 12): counted, grouped and paged by the database (report_inventory_aging, migration 0066).
export default async function InventoryAgingReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const group = (sp.custody && sp.custody in CUSTODY_GROUPS ? sp.custody : "") as CustodyGroup | "";
  const band = (sp.age && sp.age in AGE_BANDS ? sp.age : "") as AgeBand | "";
  const all = sp.all === "1";

  const supabase = await createClient();
  const r = reportData<ReportInventory>(
    await supabase.rpc("report_inventory_aging", { p_custody: group || undefined, p_band: band || undefined, p_page: pageParam(sp.page), p_size: pageSizeFor(all) }),
  );
  const bandCount = (b: AgeBand) => Number(r.band_counts?.[b] ?? 0);
  const groupCount = (g: CustodyGroup) => Number(r.custody_counts?.[g] ?? 0);
  const current = { custody: group || undefined, age: band || undefined };
  const filtered = Boolean(group || band);

  return (
    <div>
      <ReportHeader
        title="Inventory aging"
        description={`Items still in the shop (In vault, Forfeited, Queued for auction) and how long each has been held. Days held are Manila calendar days from the day the item came in, as on the Inventory page. Over ${AGED_DAYS} days is highlighted.`}
        subtitle={`${r.all_count} item${r.all_count === 1 ? "" : "s"} in the shop · ${r.aged_count} held over ${AGED_DAYS} days · as of ${formatDate(r.today)}`}
      />

      {/* how many items are in each age group (for the custody filter picked) */}
      <dl className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {(Object.keys(AGE_BANDS) as AgeBand[]).map((b) => (
          <div key={b} className="rounded-md border border-slate-200 bg-white px-4 py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{AGE_BANDS[b]}</dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">{bandCount(b)}</dd>
          </div>
        ))}
      </dl>

      <Card padded={false}>
        <ViewToolbar viewing={[group ? CUSTODY_GROUPS[group] : "All in the shop", band ? AGE_BANDS[band] : null].filter(Boolean).join(" · ")}>
          <NavSelect
            label="Custody"
            value={group}
            options={[{ value: "", label: `All in the shop (${r.all_count})`, href: reportHref(BASE, current, { custody: undefined }) }].concat(
              (Object.keys(CUSTODY_GROUPS) as CustodyGroup[]).map((g) => ({ value: g, label: `${CUSTODY_GROUPS[g]} (${groupCount(g)})`, href: reportHref(BASE, current, { custody: g }) })),
            )}
          />
          <NavSelect
            label="Days held"
            value={band}
            options={[{ value: "", label: "Any", href: reportHref(BASE, current, { age: undefined }) }].concat(
              (Object.keys(AGE_BANDS) as AgeBand[]).map((b) => ({ value: b, label: `${AGE_BANDS[b]} (${bandCount(b)})`, href: reportHref(BASE, current, { age: b }) })),
            )}
          />
        </ViewToolbar>
        {r.total ? (
          <>
            <PrintScope page={r.page} size={r.size} total={r.total} shown={r.rows.length} all={all} totalRow={false} />
            <Table minWidth="760px">
              <THead>
                <TH>Vault location</TH>
                <TH>Item</TH>
                <TH>Pawner</TH>
                <TH>Custody</TH>
                <TH>Received</TH>
                <TH align="right">Days held</TH>
              </THead>
              <TBody>
                {r.rows.map((item) => {
                  const old = item.days > AGED_DAYS;
                  const custody = CUSTODY[item.status];
                  return (
                    <TR key={item.id} highlight={old ? "warning" : undefined}>
                      <TD className="font-medium">{item.vault_location}</TD>
                      <TD>
                        {item.category ? `${categoryLabel(item.category, item.category_other)}, ${item.karat}K, ${item.weight_grams} g` : ""}
                        {item.appraisal_no ? <span className="block font-mono text-xs text-slate-500">{appraisalNo(item.appraisal_no)}</span> : null}
                      </TD>
                      <TD>{item.customer_name ?? ""}</TD>
                      <TD>
                        <Badge tone={custody.tone}>{custody.label}</Badge>
                      </TD>
                      <TD className="whitespace-nowrap">{formatDate(item.received)}</TD>
                      <TD align="right" className={old ? "font-semibold text-amber-900" : undefined}>
                        {item.days}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pagination page={r.page} pageSize={r.size} total={r.total} basePath={BASE} params={{ ...current, all: all ? "1" : undefined }} />
            <ShowAllLink all={all} total={r.total} href={reportHref(BASE, current, { all: all ? undefined : "1" })} />
          </>
        ) : (
          <EmptyState icon="vault" title={filtered ? "No item matches" : "The vault is empty"} description={filtered ? "Try All in the shop or Any in Days held." : undefined} />
        )}
      </Card>
    </div>
  );
}
