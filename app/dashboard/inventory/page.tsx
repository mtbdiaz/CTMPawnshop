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
  ActionsCell,
  ViewButton,
  pageParam,
} from "@/components/ui";
import { ITEM_CATEGORIES, categoryLabel } from "@/lib/appraisal/valuation";

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
  appraisal_items: { category: string; category_other: string | null; weight_grams: number; karat: number } | null;
  loans: { id: string; ticket_number: string; customers: { full_name: string } | null }[];
};

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; category?: string }>;
}) {
  const user = await requireRole(["operator", "cashier", "appraiser", "admin"]);
  const params = await searchParams;
  const status = FILTERS[params.status ?? ""] ? params.status! : "vault";
  const page = pageParam(params.page);
  const isOperator = hasRole(user.profile.role, ["operator"]);
  const category = ITEM_CATEGORIES.some((c) => c.value === params.category) ? (params.category as Enums<"item_category">) : null;

  const supabase = await createClient();
  let query = supabase
    .from("inventory_items")
    .select(`id, vault_location, status, created_at, updated_at, appraisal_items${category ? "!inner" : ""}(category, category_other, weight_grams, karat), loans(id, ticket_number, customers(full_name))`, {
      count: "exact",
    })
    .is("archived_at", null)
    .order("vault_location")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (FILTERS[status].statuses.length) query = query.in("status", FILTERS[status].statuses);
  if (category) query = query.eq("appraisal_items.category", category);
  const href = (o: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ status: params.status, category: params.category, ...o })) if (v) qs.set(k, v);
    const q = qs.toString();
    return q ? `/dashboard/inventory?${q}` : "/dashboard/inventory";
  };
  const { data, count, error } = await query;
  if (error) throw error;
  const items = (data ?? []) as unknown as Row[];

  return (
    <div>
      <PageHeader
        title="Vault inventory"
        description="Every pledged item, where it is stored, and its status."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Inventory" }]}
        actions={
          isOperator && (
            <>
              <ButtonLink href="/dashboard/inventory/audit">Physical audit</ButtonLink>
              <ButtonLink href="/dashboard/inventory/auction">Auction prep</ButtonLink>
            </>
          )
        }
      />

      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-slate-200 p-3">
          <FilterTabs
            current={status}
            tabs={Object.entries(FILTERS).map(([value, f]) => ({ value, label: f.label, href: href({ status: value === "vault" ? undefined : value }) }))}
          />
          <FilterTabs
            current={category ?? "any"}
            tabs={[{ label: "Any category", value: "any", href: href({ category: undefined }) }].concat(
              ITEM_CATEGORIES.map((c) => ({ label: c.label, value: c.value, href: href({ category: c.value }) })),
            )}
          />
        </div>
        {items.length > 0 ? (
          <>
            <Table minWidth="820px">
              <THead>
                <TH>Vault location</TH>
                <TH>Item</TH>
                <TH>Pawner</TH>
                <TH>Loan</TH>
                <TH>Status</TH>
                <TH align="right">Days held</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </THead>
              <TBody>
                {items.map((item) => {
                  const loan = item.loans?.[0];
                  return (
                    <TR key={item.id}>
                      <TD className="font-medium">{item.vault_location}</TD>
                      <TD>
                        {item.appraisal_items
                          ? `${categoryLabel(item.appraisal_items.category, item.appraisal_items.category_other)}, ${item.appraisal_items.karat}K, ${item.appraisal_items.weight_grams} g`
                          : ""}
                      </TD>
                      <TD>{loan?.customers?.full_name ?? ""}</TD>
                      <TD mono>{loan?.ticket_number ?? ""}</TD>
                      <TD>
                        <StatusBadge status={item.status} label={item.status === "extended" ? "Renewed" : undefined} />
                        <span className="mt-0.5 block text-xs text-slate-500">since {formatDate(item.updated_at)}</span>
                      </TD>
                      <TD align="right">{daysInVault(new Date(item.created_at))}</TD>
                      <ActionsCell>{loan && <ViewButton href={`/dashboard/loans/${loan.id}`}>View loan</ViewButton>}</ActionsCell>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/dashboard/inventory" params={{ status: params.status, category: params.category }} />
          </>
        ) : (
          <EmptyState title={`No items ${FILTERS[status].label.toLowerCase()}.`} />
        )}
      </Card>
    </div>
  );
}
