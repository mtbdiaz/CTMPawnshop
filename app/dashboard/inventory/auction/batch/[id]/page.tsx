import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatPeso } from "@/lib/format";
import { batchNo, batchStatus, type AuctionLinePage } from "@/lib/inventory/auction";
import { Badge, Card, DetailGrid, EmptyState, PageHeader, Pagination, pageParam } from "@/components/ui";
import { LineRow } from "../../line-row";

export const metadata = { title: "Auction batch" };

const PAGE_SIZE = 25; // a batch is usually small; 25 keeps most batches on one page
const BASE = "/dashboard/inventory/auction";

// AP1 (Nov 12, migration 0052): one auction batch on its own page.
// Before: a batch was one line on the Auction prep page (date, note, "3 item(s) · 0 sold") and could not be opened.
// Now: its number, who made it and when, the auction date and place, every item with its reserve and what happened
// to it, and the totals. The same buttons as the Queued items tab work here for items still waiting.
export default async function AuctionBatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const user = await requireRole(["operator", "admin"]);
  const { id } = await params;
  const page = pageParam((await searchParams).page);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();

  const [{ data: batch }, { data: all }, { data: linesData, error }] = await Promise.all([
    supabase
      .from("auction_batches")
      .select("id, batch_no, created_at, notes, auction_date, auction_place, archived_at, profiles!auction_batches_created_by_fkey(full_name)")
      .eq("id", id)
      .maybeSingle(),
    // every line of the batch, only the fields the totals need
    supabase.from("auction_batch_items").select("sold_at, unsold_at, sale_price, min_price, no_reserve").eq("batch_id", id),
    // the items of this page, with everything the rows show
    supabase.rpc("auction_lines", { p_kind: "batch", p_batch: id, p_page: page, p_size: PAGE_SIZE }),
  ]);
  if (!batch || batch.archived_at) notFound(); // an archived batch is only in the Archive
  if (error) throw error;
  const res = linesData as unknown as AuctionLinePage;
  const lines = all ?? [];
  const soldLines = lines.filter((l) => l.sold_at);
  const c = { items: lines.length, sold: soldLines.length, unsold: lines.filter((l) => l.unsold_at).length };
  const waiting = c.items - c.sold - c.unsold;
  const notSet = lines.filter((l) => !l.sold_at && !l.unsold_at && l.min_price == null && !l.no_reserve).length;
  const status = batchStatus(c);
  const ref = batchNo(batch.batch_no);
  const createdBy = (batch as unknown as { profiles: { full_name: string } | null }).profiles?.full_name ?? "staff";

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            Auction batch {ref} <Badge tone={status.tone}>{status.label}</Badge>
          </span>
        }
        description={batch.notes ?? undefined}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Inventory", href: "/dashboard/inventory" },
          { label: "Auction prep", href: `${BASE}?tab=batches` },
          { label: ref },
        ]}
      />

      <Card>
        <DetailGrid
          items={[
            { label: "Batch reference", value: ref, emphasize: true },
            { label: "Created", value: `${formatDateTime(batch.created_at)} by ${createdBy}` },
            { label: "Auction date", value: batch.auction_date ? formatDate(batch.auction_date) : "Not set" },
            { label: "Auction place", value: batch.auction_place ?? "Not set" },
            { label: "Items", value: `${c.items} (${waiting} waiting)` },
            { label: "Sold", value: String(c.sold) },
            { label: "Not sold", value: String(c.unsold) },
            { label: "Proceeds from recorded sales", value: formatPeso(soldLines.reduce((t, l) => t + Number(l.sale_price ?? 0), 0)), emphasize: true },
          ]}
        />
        {/* what the status means, and what still needs doing */}
        <p className="mt-3 text-xs text-slate-600">
          {status.label === "Open" && "Open: no sale or unsold result was recorded yet."}
          {status.label === "In progress" && `In progress: ${waiting} item${waiting === 1 ? " is" : "s are"} still waiting for a result.`}
          {status.label === "Closed" && "Closed: every item was sold or marked not sold."}
          {notSet > 0 && ` ${notSet} waiting item${notSet === 1 ? " has" : "s have"} no reserve decision yet; set it before recording a sale.`}
        </p>
      </Card>

      <Card padded={false}>
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Items in this batch</h2>
        {res.rows.length ? (
          <>
            <ul className="divide-y divide-slate-100">
              {res.rows.map((l) => (
                <LineRow key={l.id} line={l} isAdmin={user.profile.role === "admin"} showBatch={false} />
              ))}
            </ul>
            <Pagination page={res.page} pageSize={PAGE_SIZE} total={res.total} basePath={`${BASE}/batch/${id}`} params={{}} />
          </>
        ) : (
          <EmptyState icon="gavel" title="No items in this batch" />
        )}
      </Card>
    </div>
  );
}
