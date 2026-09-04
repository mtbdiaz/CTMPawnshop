import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { AuctionForm } from "./auction-form";

export default async function AuctionPrepPage() {
  await requireRole(["operator", "admin"]);

  const supabase = await createClient();
  const { data: items } = await supabase
    .from("inventory_items")
    .select("id, appraisal_items(weight_grams, karat, customers(full_name))")
    .eq("status", "forfeited");

  const rows = (items ?? []).map((item) => {
    const appraisal = (
      item as unknown as {
        appraisal_items: { weight_grams: number; karat: number; customers: { full_name: string } | null } | null;
      }
    ).appraisal_items;
    return {
      id: item.id,
      label: `${appraisal?.customers?.full_name ?? "—"} — ${appraisal?.weight_grams}g ${appraisal?.karat}k`,
    };
  });

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Auction &amp; Forfeiture Prep</h1>
      <p className="mt-1 text-sm text-slate-500">
        Batch forfeited items together to prepare for the next liquidation/auction cycle.
      </p>
      <div className="mt-6">
        {rows.length ? (
          <AuctionForm items={rows} />
        ) : (
          <p className="text-sm text-slate-500">No forfeited items awaiting auction prep.</p>
        )}
      </div>
    </div>
  );
}
