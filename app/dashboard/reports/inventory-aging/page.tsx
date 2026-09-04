import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/print-button";
import { daysInVault } from "@/lib/reports/loans";

const AGING_THRESHOLD_DAYS = 60;

export default async function InventoryAgingReport() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const { data: items } = await supabase
    .from("inventory_items")
    .select("*, appraisal_items(weight_grams, karat, customers(full_name))")
    .order("created_at");

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Inventory Aging Report</h1>
        <PrintButton />
      </div>
      <p className="mt-1 text-sm text-slate-500 print:hidden">
        How long each item has sat in the vault. Items over {AGING_THRESHOLD_DAYS} days are
        highlighted.
      </p>

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500">
            <th className="pb-2 pr-4">Customer</th>
            <th className="pb-2 pr-4">Item</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2 pr-4">Days in vault</th>
          </tr>
        </thead>
        <tbody>
          {items?.length ? (
            items.map((item) => {
              const appraisal = (
                item as unknown as {
                  appraisal_items: { weight_grams: number; karat: number; customers: { full_name: string } | null } | null;
                }
              ).appraisal_items;
              const days = daysInVault(new Date(item.created_at));
              return (
                <tr key={item.id} className="border-t border-slate-200">
                  <td className="py-2 pr-4">{appraisal?.customers?.full_name ?? "—"}</td>
                  <td className="py-2 pr-4">
                    {appraisal?.weight_grams}g {appraisal?.karat}k
                  </td>
                  <td className="py-2 pr-4 capitalize">{item.status}</td>
                  <td className={`py-2 pr-4 ${days > AGING_THRESHOLD_DAYS ? "font-semibold text-red-700" : ""}`}>
                    {days}
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={4} className="py-4 text-sm text-slate-500">
                No inventory items.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
