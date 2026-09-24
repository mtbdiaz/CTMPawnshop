import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { AuditForm } from "./audit-form";

export const metadata = { title: "Physical audit" };

export default async function InventoryAuditPage() {
  await requireRole(["operator", "admin"]);

  const supabase = await createClient();
  const [{ data: items, error }, { data: history }] = await Promise.all([
    supabase
      .from("inventory_items")
      .select("id, status, vault_location, appraisal_items(weight_grams, karat, customers(full_name))")
      .in("status", ["pawned", "extended"])
      .order("vault_location"),
    supabase
      .from("physical_inventory_audits")
      .select("id, created_at, discrepancy_count, notes")
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
      status: item.status,
      vault_location: item.vault_location,
      label: `${appraisal?.customers?.full_name ?? "—"} — ${appraisal?.weight_grams}g ${appraisal?.karat}k`,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Physical inventory audit"
        description="Walk the vault and check each item against the system. Untick anything you can't physically find, and add a note."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Inventory", href: "/dashboard/inventory" },
          { label: "Physical audit" },
        ]}
      />

      <Card padded={false}>
        {rows.length ? (
          <AuditForm items={rows} />
        ) : (
          <EmptyState icon="vault" title="Nothing to audit" description="There are no pawned items in the vault right now." />
        )}
      </Card>

      <section>
        <SectionTitle>Recent audits</SectionTitle>
        <Card padded={false}>
          {history && history.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {history.map((audit) => (
                <li key={audit.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span>
                    {formatDateTime(audit.created_at)}
                    {audit.notes && <span className="block text-xs text-slate-500">{audit.notes}</span>}
                  </span>
                  {audit.discrepancy_count > 0 ? (
                    <Badge tone="danger" icon>
                      {audit.discrepancy_count} discrepanc{audit.discrepancy_count === 1 ? "y" : "ies"}
                    </Badge>
                  ) : (
                    <Badge tone="success">All accounted for</Badge>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="clipboard" title="No audits recorded yet" />
          )}
        </Card>
      </section>
    </div>
  );
}
