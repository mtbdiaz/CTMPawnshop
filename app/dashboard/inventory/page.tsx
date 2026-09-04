import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export default async function InventoryPage() {
  await requireRole(["operator", "cashier", "appraiser", "admin"]);

  const supabase = await createClient();
  const { data: items } = await supabase
    .from("inventory_items")
    .select("*, appraisal_items(weight_grams, karat, customers(full_name))")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Vault Inventory</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every pawned item, its vault location, and current status.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/inventory/audit"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
          >
            Physical audit
          </Link>
          <Link
            href="/dashboard/inventory/auction"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
          >
            Auction prep
          </Link>
        </div>
      </div>

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500">
            <th className="pb-2 pr-4">Customer</th>
            <th className="pb-2 pr-4">Item</th>
            <th className="pb-2 pr-4">Vault location</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2 pr-4">Since</th>
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
              return (
                <tr key={item.id} className="border-t border-slate-200">
                  <td className="py-2 pr-4">{appraisal?.customers?.full_name ?? "—"}</td>
                  <td className="py-2 pr-4">
                    {appraisal?.weight_grams}g {appraisal?.karat}k
                  </td>
                  <td className="py-2 pr-4">{item.vault_location}</td>
                  <td className="py-2 pr-4">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                      {item.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-slate-500">
                    {new Date(item.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={5} className="py-4 text-sm text-slate-500">
                No inventory items yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
