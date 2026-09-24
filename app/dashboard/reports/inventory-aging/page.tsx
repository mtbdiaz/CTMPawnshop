import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { daysInVault } from "@/lib/reports/loans";
import { formatDate } from "@/lib/format";
import { ReportHeader } from "@/components/report-header";
import { Card, EmptyState, StatusBadge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";

export const metadata = { title: "Inventory aging report" };

const AGING_THRESHOLD_DAYS = 60;

type Row = {
  id: string;
  vault_location: string;
  status: string;
  created_at: string;
  appraisal_items: { weight_grams: number; karat: number; customers: { full_name: string } | null } | null;
};

export default async function InventoryAgingReport() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  // Only items physically in the vault — redeemed items have been returned to the customer.
  const { data, error } = await supabase
    .from("inventory_items")
    .select("id, vault_location, status, created_at, appraisal_items(weight_grams, karat, customers(full_name))")
    .in("status", ["pawned", "extended", "forfeited", "queued_for_auction"])
    .order("created_at");
  if (error) throw error;
  const items = (data ?? []) as unknown as Row[];
  const aged = items.filter((i) => daysInVault(new Date(i.created_at)) > AGING_THRESHOLD_DAYS).length;

  return (
    <div>
      <ReportHeader
        title="Inventory aging"
        description={`How long each item currently in the vault has been held. Items over ${AGING_THRESHOLD_DAYS} days are highlighted.`}
        subtitle={`${items.length} item${items.length === 1 ? "" : "s"} in vault · ${aged} over ${AGING_THRESHOLD_DAYS} days`}
      />
      <Card padded={false}>
        {items.length ? (
          <Table>
            <THead>
              <TH>Vault location</TH>
              <TH>Pawner</TH>
              <TH>Item</TH>
              <TH>Status</TH>
              <TH>Received</TH>
              <TH align="right">Days held</TH>
            </THead>
            <TBody>
              {items.map((item) => {
                const days = daysInVault(new Date(item.created_at));
                const old = days > AGING_THRESHOLD_DAYS;
                return (
                  <TR key={item.id} highlight={old ? "warning" : undefined}>
                    <TD className="font-medium">{item.vault_location}</TD>
                    <TD>{item.appraisal_items?.customers?.full_name ?? "—"}</TD>
                    <TD>
                      {item.appraisal_items?.weight_grams}g · {item.appraisal_items?.karat}k
                    </TD>
                    <TD>
                      <StatusBadge status={item.status} label={item.status === "extended" ? "Renewed" : undefined} />
                    </TD>
                    <TD>{formatDate(item.created_at)}</TD>
                    <TD align="right" className={old ? "font-semibold text-amber-900" : undefined}>
                      {days}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : (
          <EmptyState icon="vault" title="The vault is empty" />
        )}
      </Card>
    </div>
  );
}
