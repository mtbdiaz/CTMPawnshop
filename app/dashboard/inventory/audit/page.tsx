import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { AuditForm } from "./audit-form";

export default async function InventoryAuditPage() {
  await requireRole(["operator", "admin"]);

  const supabase = await createClient();
  const { data: items } = await supabase
    .from("inventory_items")
    .select("id, status, vault_location, appraisal_items(weight_grams, karat, customers(full_name))")
    .in("status", ["pawned", "extended"])
    .order("vault_location");

  const rows = (items ?? []).map((item) => {
    const appraisal = (
      item as unknown as {
        appraisal_items: { weight_grams: number; karat: number; customers: { full_name: string } | null } | null;
      }
    ).appraisal_items;
    return {
      id: item.id,
      status: item.status,
      vault_location: item.vault_location,
      label: `${appraisal?.customers?.full_name ?? "—"} — ${appraisal?.weight_grams}g ${appraisal?.karat}k`,
    };
  });

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Physical Inventory Audit</h1>
      <p className="mt-1 text-sm text-slate-500">
        Reconcile the actual vault contents against system records. Uncheck any item not
        physically found.
      </p>
      <div className="mt-6">
        {rows.length ? (
          <AuditForm items={rows} />
        ) : (
          <p className="text-sm text-slate-500">No pawned items currently in the vault to audit.</p>
        )}
      </div>
    </div>
  );
}
