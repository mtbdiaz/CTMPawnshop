import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatPeso } from "@/lib/format";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { Badge, Card, EmptyState, PageHeader, Pagination, SectionTitle, pageParam } from "@/components/ui";
import { AuctionForm } from "./auction-form";
import { RecordSaleButton } from "./record-sale-button";

export const metadata = { title: "Auction prep" };

const PAGE_SIZE = 10; // queued items per page, same as the other lists
const BASE = "/dashboard/inventory/auction";

// the item fields every list on this page needs
type Appraisal = { category: string; category_other: string | null; weight_grams: number; karat: number; computed_value: number; customers: { full_name: string } | null } | null;
// one loan per item; the database returns it as a list or a single row depending on the relationship
type LoanRef = { ticket_number: string } | { ticket_number: string }[] | null;
const ticketOf = (l: LoanRef) => (Array.isArray(l) ? l[0]?.ticket_number : l?.ticket_number) ?? "";
const itemLabel = (a: Appraisal) => (a ? `${categoryLabel(a.category, a.category_other)}, ${a.karat}K, ${a.weight_grams} g` : "Item");

export default async function AuctionPrepPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireRole(["operator", "admin"]);
  const params = await searchParams;
  const page = pageParam(params.page);
  const supabase = await createClient();

  const [{ data: items, error }, queuedRes, { data: sales }, { data: batches }] = await Promise.all([
    // 1. forfeited items not in a batch yet (an Admin forfeited the loan)
    supabase
      .from("inventory_items")
      .select("id, vault_location, appraisal_items(category, category_other, weight_grams, karat, computed_value, customers(full_name))")
      .eq("status", "forfeited")
      .is("archived_at", null)
      .order("vault_location"),
    // 2. #43: items queued in an open batch and not sold yet, 10 per page, oldest batch first
    supabase
      .from("auction_batch_items")
      .select(
        "id, min_price, auction_batches!inner(created_at, notes, archived_at), inventory_items!inner(id, status, vault_location, appraisal_items(category, category_other, weight_grams, karat, computed_value, customers(full_name)), loans(ticket_number))",
        { count: "exact" },
      )
      .is("sold_at", null)
      .is("auction_batches.archived_at", null)
      .eq("inventory_items.status", "queued_for_auction")
      .order("created_at", { referencedTable: "auction_batches", ascending: true })
      .order("id")
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    // 3. #43: the 5 newest sales, with who recorded them
    supabase
      .from("auction_batch_items")
      .select("id, sold_at, sale_price, min_price, buyer_name, sale_notes, profiles(full_name), inventory_items(appraisal_items(category, category_other, weight_grams, karat, computed_value, customers(full_name)), loans(ticket_number))")
      .not("sold_at", "is", null)
      .order("sold_at", { ascending: false })
      .limit(5),
    // 4. the 5 newest open batches, with how many of their items are sold
    supabase
      .from("auction_batches")
      .select("id, created_at, notes, auction_batch_items(id, sold_at, sale_price)")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  if (error) throw error;
  if (queuedRes.error) throw queuedRes.error;

  const rows = (items ?? []).map((item) => {
    const a = (item as unknown as { appraisal_items: Appraisal }).appraisal_items;
    return {
      id: item.id,
      location: item.vault_location,
      value: Number(a?.computed_value ?? 0), // the appraised value, a guide for the minimum price
      // B2: "pawned by <customer>": the customer pawned the item; an Admin is the one who forfeited it
      label: `${itemLabel(a)}, pawned by ${a?.customers?.full_name ?? ""}`,
    };
  });

  type QueuedRow = {
    id: string;
    min_price: number | null;
    auction_batches: { created_at: string; notes: string | null };
    inventory_items: { id: string; vault_location: string; appraisal_items: Appraisal; loans: LoanRef };
  };
  const queued = (queuedRes.data ?? []) as unknown as QueuedRow[];
  const queuedTotal = queuedRes.count ?? 0;

  type SaleRow = {
    id: string;
    sold_at: string;
    sale_price: number;
    min_price: number | null;
    buyer_name: string | null;
    sale_notes: string | null;
    profiles: { full_name: string } | null;
    inventory_items: { appraisal_items: Appraisal; loans: LoanRef } | null;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auction prep"
        description="Group forfeited items into a batch with a minimum price, then record each sale."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Inventory", href: "/dashboard/inventory" },
          { label: "Auction prep" },
        ]}
      />

      {/* step 1: forfeited items → a batch */}
      <section>
        <SectionTitle>1. Forfeited items ({rows.length})</SectionTitle>
        <Card>
          {rows.length ? (
            <AuctionForm items={rows} />
          ) : (
            <EmptyState icon="gavel" title="No forfeited items waiting" description="Items appear here after an Admin forfeits a defaulted loan." />
          )}
        </Card>
      </section>

      {/* step 2 (#43): queued items → Record sale */}
      <section>
        <SectionTitle>2. Queued for auction ({queuedTotal})</SectionTitle>
        <Card padded={false}>
          {queued.length ? (
            <>
              <ul className="divide-y divide-slate-100">
                {queued.map((q) => {
                  const a = q.inventory_items.appraisal_items;
                  const ticket = ticketOf(q.inventory_items.loans);
                  return (
                    <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                      <span className="min-w-0">
                        <span className="block font-medium text-slate-900">{itemLabel(a)}</span>
                        <span className="block text-xs text-slate-600">
                          {ticket} · pawned by {a?.customers?.full_name ?? ""} · {q.inventory_items.vault_location}
                        </span>
                        <span className="block text-xs text-slate-500">
                          Batch of {formatDate(q.auction_batches.created_at)}
                          {q.auction_batches.notes ? ` (${q.auction_batches.notes})` : ""} · appraised {formatPeso(Number(a?.computed_value ?? 0))}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        {/* UC18: the minimum price, so staff know the lowest acceptable bid */}
                        <span className="text-right text-xs text-slate-600">
                          Minimum
                          <span className="block text-sm font-medium tabular-nums text-slate-900">{q.min_price ? formatPeso(q.min_price) : "None"}</span>
                        </span>
                        <RecordSaleButton itemId={q.inventory_items.id} label={itemLabel(a)} ticket={ticket} minPrice={q.min_price ? Number(q.min_price) : null} value={Number(a?.computed_value ?? 0)} />
                      </span>
                    </li>
                  );
                })}
              </ul>
              <Pagination page={page} pageSize={PAGE_SIZE} total={queuedTotal} basePath={BASE} params={{}} />
            </>
          ) : (
            <EmptyState icon="gavel" title="Nothing queued for auction" description="Create a batch above. Its items show here until each sale is recorded." />
          )}
        </Card>
      </section>

      {/* #43: the newest sales, so the record is easy to check */}
      <section>
        <SectionTitle>Recent sales</SectionTitle>
        <Card padded={false}>
          {sales && sales.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {(sales as unknown as SaleRow[]).map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                      {itemLabel(s.inventory_items?.appraisal_items ?? null)} <Badge tone="neutral">Sold</Badge>
                    </span>
                    <span className="block text-xs text-slate-600">
                      {ticketOf(s.inventory_items?.loans ?? null)} · {formatDateTime(s.sold_at)} · recorded by {s.profiles?.full_name ?? "staff"}
                      {s.buyer_name ? ` · buyer: ${s.buyer_name}` : ""}
                    </span>
                    {s.sale_notes && <span className="block break-words text-xs italic text-slate-600">&ldquo;{s.sale_notes}&rdquo;</span>}
                  </span>
                  <span className="font-medium tabular-nums">{formatPeso(s.sale_price)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="gavel" title="No sales recorded yet" />
          )}
        </Card>
      </section>

      <section>
        <SectionTitle>Recent batches</SectionTitle>
        <Card padded={false}>
          {batches && batches.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {batches.map((b) => {
                const lines = (b as unknown as { auction_batch_items: { sold_at: string | null; sale_price: number | null }[] }).auction_batch_items;
                const sold = lines.filter((l) => l.sold_at); // #43: how many of this batch are sold, and for how much
                return (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span>
                      {formatDateTime(b.created_at)}
                      {b.notes && <span className="block text-xs text-slate-500">{b.notes}</span>}
                    </span>
                    <span className="text-right text-slate-600">
                      {lines.length} item(s) · {sold.length} sold
                      {sold.length > 0 && <span className="block text-xs">{formatPeso(sold.reduce((t, l) => t + Number(l.sale_price ?? 0), 0))} total</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon="gavel" title="No auction batches yet" />
          )}
        </Card>
      </section>
    </div>
  );
}
