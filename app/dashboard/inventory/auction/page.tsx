import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { AuctionForm } from "./auction-form";

export const metadata = { title: "Auction prep" };

export default async function AuctionPrepPage() {
  await requireRole(["operator", "admin"]);

  const supabase = await createClient();
  const [{ data: items, error }, { data: batches }] = await Promise.all([
    supabase
      .from("inventory_items")
      .select("id, vault_location, appraisal_items(weight_grams, karat, customers(full_name))")
      .eq("status", "forfeited")
      .order("vault_location"),
    supabase
      .from("auction_batches")
      .select("id, created_at, notes, auction_batch_items(id)")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  if (error) throw error;

  const rows = (items ?? []).map((item) => {
    const appraisal = (
      item as unknown as {
        appraisal_items: { weight_grams: number; karat: number; customers: { full_name: string } | null } | null;
      }
    ).appraisal_items;
    return {
      id: item.id,
      location: item.vault_location,
      label: `${appraisal?.weight_grams}g ${appraisal?.karat}k — forfeited by ${appraisal?.customers?.full_name ?? "—"}`,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auction & forfeiture prep"
        description="Group forfeited items into a batch for the next liquidation or auction cycle."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Inventory", href: "/dashboard/inventory" },
          { label: "Auction prep" },
        ]}
      />

      <Card>
        {rows.length ? (
          <AuctionForm items={rows} />
        ) : (
          <EmptyState icon="gavel" title="No forfeited items waiting" description="Items appear here once a loan defaults past its grace period." />
        )}
      </Card>

      <section>
        <SectionTitle>Recent batches</SectionTitle>
        <Card padded={false}>
          {batches && batches.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {batches.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span>
                    {formatDateTime(b.created_at)}
                    {b.notes && <span className="block text-xs text-slate-500">{b.notes}</span>}
                  </span>
                  <span className="text-slate-600">
                    {(b as unknown as { auction_batch_items: unknown[] }).auction_batch_items.length} item(s)
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="gavel" title="No auction batches yet" />
          )}
        </Card>
      </section>
    </div>
  );
}
