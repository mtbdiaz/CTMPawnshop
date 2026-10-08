import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPeso } from "@/lib/format";
import { ITEM_CATEGORIES, categoryLabel } from "@/lib/appraisal/valuation";
import type { Enums } from "@/lib/supabase/database.types";
import {
  ActionsCell,
  Card,
  CreatePanel,
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
  ViewButton,
  pageParam,
} from "@/components/ui";
import { AppraisalCalculator } from "./appraisal-calculator";

export const metadata = { title: "Appraisals" };

const PAGE_SIZE = 25;

// Item 4: the Appraisals tab is the pre-pawn pool. Pawned, redeemed and
// archived items never appear here.
export default async function AppraisalsPage({
  searchParams,
}: {
  searchParams: Promise<{ risk?: string; category?: string; page?: string; new?: string }>;
}) {
  const user = await requireRole(["appraiser", "cashier", "operator", "admin"]);
  const params = await searchParams;
  const page = pageParam(params.page);
  const risk = params.risk === "pending" ? "pending" : "all";
  const category = ITEM_CATEGORIES.some((c) => c.value === params.category) ? (params.category as Enums<"item_category">) : null;
  const canAppraise = hasRole(user.profile.role, ["appraiser"]);

  const supabase = await createClient();
  let query = supabase
    .from("appraisal_items")
    .select("id, category, category_other, karat, weight_grams, computed_value, suggested_loan_max, is_counterfeit_risk, counterfeit_resolution, created_at", { count: "exact" })
    .eq("status", "available")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (risk === "pending") query = query.eq("is_counterfeit_risk", true).eq("counterfeit_resolution", "pending");
  if (category) query = query.eq("category", category);

  const [{ data: rows, count, error }, { data: settings }] = await Promise.all([
    query,
    supabase.from("system_settings").select("price_24k, price_21k, price_18k, ltv_percent").eq("id", 1).maybeSingle(),
  ]);
  if (error) throw error;

  const tabParams = (overrides: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    const merged = { risk: params.risk, category: params.category, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
    const s = qs.toString();
    return s ? `/dashboard/appraisals?${s}` : "/dashboard/appraisals";
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Appraisals"
        description="Items appraised and waiting to be pawned. Once a loan is issued against an item it leaves this list."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Appraisals" }]}
      />

      {canAppraise && settings && (
        <CreatePanel title="New appraisal" description="Category, karat and weight. Value and maximum loan update as you type." defaultOpen={params.new === "1"}>
          <AppraisalCalculator prices={settings} ltvPercent={Number(settings.ltv_percent)} />
        </CreatePanel>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-3">
          <FilterTabs
            current={risk}
            tabs={[
              { label: "Available", value: "all", href: tabParams({ risk: undefined }) },
              { label: "Awaiting counterfeit review", value: "pending", href: tabParams({ risk: "pending" }) },
            ]}
          />
          <FilterTabs
            current={category ?? "any"}
            tabs={[{ label: "Any category", value: "any", href: tabParams({ category: undefined }) }].concat(
              ITEM_CATEGORIES.map((c) => ({ label: c.label, value: c.value, href: tabParams({ category: c.value }) })),
            )}
          />
        </div>
        {rows && rows.length > 0 ? (
          <>
            <Table minWidth="760px">
              <THead>
                <TH>Item</TH>
                <TH align="right">Weight</TH>
                <TH align="right">Value</TH>
                <TH align="right">Max loan</TH>
                <TH>Check</TH>
                <TH>Appraised</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </THead>
              <TBody>
                {rows.map((a) => {
                  const pending = a.is_counterfeit_risk && a.counterfeit_resolution === "pending";
                  return (
                    <TR key={a.id} highlight={pending ? "danger" : undefined}>
                      <TD>
                        {categoryLabel(a.category, a.category_other)}, {a.karat}K
                      </TD>
                      <TD align="right">{a.weight_grams} g</TD>
                      <TD align="right">{formatPeso(a.computed_value)}</TD>
                      <TD align="right">{formatPeso(a.suggested_loan_max)}</TD>
                      <TD>
                        {a.is_counterfeit_risk ? (
                          <StatusBadge status={a.counterfeit_resolution ?? "pending"} label={pending ? "Counterfeit review" : a.counterfeit_resolution === "cleared" ? "Cleared" : "Confirmed risk"} />
                        ) : (
                          <span className="text-slate-500">OK</span>
                        )}
                      </TD>
                      <TD className="text-slate-600">{formatDate(a.created_at)}</TD>
                      <ActionsCell>
                        <ViewButton href={`/dashboard/appraisals/${a.id}`}>View appraisal</ViewButton>
                      </ActionsCell>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/dashboard/appraisals" params={{ risk: params.risk, category: params.category }} />
          </>
        ) : (
          <EmptyState title={risk === "pending" ? "No items awaiting counterfeit review." : "No available items."} description={canAppraise ? "Use New appraisal above to add one." : undefined} />
        )}
      </Card>
    </div>
  );
}
