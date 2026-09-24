import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { daysInVault } from "@/lib/reports/loans";
import type { Enums } from "@/lib/supabase/database.types";
import {
  ButtonLink,
  Card,
  EmptyState,
  FilterTabs,
  PageHeader,
  Pagination,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TableLink,
  pageParam,
} from "@/components/ui";
import { Icon } from "@/components/icons";

export const metadata = { title: "Vault inventory" };

const PAGE_SIZE = 30;
const FILTERS: Record<string, { label: string; statuses: Enums<"inventory_status">[] }> = {
  vault: { label: "In vault", statuses: ["pawned", "extended"] },
  forfeited: { label: "Forfeited", statuses: ["forfeited"] },
  auction: { label: "Queued for auction", statuses: ["queued_for_auction"] },
  released: { label: "Released", statuses: ["redeemed"] },
  all: { label: "All", statuses: [] },
};

type Row = {
  id: string;
  vault_location: string;
  status: string;
  created_at: string;
  updated_at: string;
  appraisal_items: { weight_grams: number; karat: number; customers: { full_name: string } | null } | null;
  loans: { id: string; ticket_number: string }[];
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const user = await requireRole(["operator", "cashier", "appraiser", "admin"]);
  const params = await searchParams;
  const status = FILTERS[params.status ?? ""] ? params.status! : "vault";
  const page = pageParam(params.page);
  const isOperator = hasRole(user.profile.role, ["operator"]);

  const supabase = await createClient();
  let query = supabase
    .from("inventory_items")
    .select("id, vault_location, status, created_at, updated_at, appraisal_items(weight_grams, karat, customers(full_name)), loans(id, ticket_number)", {
      count: "exact",
    })
    .order("vault_location")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (FILTERS[status].statuses.length) query = query.in("status", FILTERS[status].statuses);
  const { data, count, error } = await query;
  if (error) throw error;
  const items = (data ?? []) as unknown as Row[];

  return (
    <div>
      <PageHeader
        title="Vault inventory"
        description="Every pledged item, where it's stored, and its current status. Statuses update automatically as loans are renewed, redeemed or forfeited."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Inventory" }]}
        actions={
          isOperator && (
            <>
              <ButtonLink href="/dashboard/inventory/audit">
                <Icon name="clipboard" className="h-4 w-4" /> Physical audit
              </ButtonLink>
              <ButtonLink href="/dashboard/inventory/auction">
                <Icon name="gavel" className="h-4 w-4" /> Auction prep
              </ButtonLink>
            </>
          )
        }
      />

      <Card padded={false}>
        <div className="border-b border-slate-200 p-4">
          <FilterTabs
            current={status}
            tabs={Object.entries(FILTERS).map(([value, f]) => ({
              value,
              label: f.label,
              href: value === "vault" ? "/dashboard/inventory" : `/dashboard/inventory?status=${value}`,
            }))}
          />
        </div>
        {items.length > 0 ? (
          <>
            <Table>
              <THead>
                <TH>Vault location</TH>
                <TH>Item</TH>
                <TH>Pawner</TH>
                <TH>Loan</TH>
                <TH>Status</TH>
                <TH align="right">Days held</TH>
              </THead>
              <TBody>
                {items.map((item) => {
                  const loan = item.loans?.[0];
                  return (
                    <TR key={item.id}>
                      <TD className="font-medium">{item.vault_location}</TD>
                      <TD>
                        {item.appraisal_items?.weight_grams}g · {item.appraisal_items?.karat}k
                      </TD>
                      <TD>{item.appraisal_items?.customers?.full_name ?? "—"}</TD>
                      <TD mono>{loan ? <TableLink href={`/dashboard/loans/${loan.id}`}>{loan.ticket_number}</TableLink> : "—"}</TD>
                      <TD>
                        <StatusBadge status={item.status} label={item.status === "extended" ? "Renewed" : undefined} />
                        <span className="mt-0.5 block text-xs text-slate-500">since {formatDate(item.updated_at)}</span>
                      </TD>
                      <TD align="right">{daysInVault(new Date(item.created_at))}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/dashboard/inventory" params={{ status: params.status }} />
          </>
        ) : (
          <EmptyState icon="vault" title={`No items ${FILTERS[status].label.toLowerCase()}`} />
        )}
      </Card>
    </div>
  );
}
