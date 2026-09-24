import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPeso } from "@/lib/format";
import {
  Alert,
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
  TableLink,
  pageParam,
} from "@/components/ui";
import { NewAppraisalForm } from "./new-appraisal-form";

export const metadata = { title: "Appraisals" };

const PAGE_SIZE = 25;

export default async function AppraisalsPage({
  searchParams,
}: {
  searchParams: Promise<{ risk?: string; page?: string; new?: string; customer?: string }>;
}) {
  const user = await requireRole(["appraiser", "cashier", "operator", "admin"]);
  const params = await searchParams;
  const page = pageParam(params.page);
  const risk = params.risk === "pending" ? "pending" : "all";
  const canAppraise = hasRole(user.profile.role, ["appraiser"]);

  const supabase = await createClient();
  let query = supabase
    .from("appraisal_items")
    .select("*, customers(full_name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (risk === "pending") query = query.eq("is_counterfeit_risk", true).eq("counterfeit_resolution", "pending");

  const [{ data: appraisals, count, error }, { data: customers }, { data: settings }, { count: pendingCount }] = await Promise.all([
    query,
    canAppraise
      ? supabase.from("customers").select("id, full_name, is_blacklisted").order("full_name")
      : Promise.resolve({ data: [] }),
    supabase.from("system_settings").select("gold_price_per_gram, ltv_percent").eq("id", 1).maybeSingle(),
    supabase
      .from("appraisal_items")
      .select("id", { count: "exact", head: true })
      .eq("is_counterfeit_risk", true)
      .eq("counterfeit_resolution", "pending"),
  ]);
  if (error) throw error;

  const goldPrice = Number(settings?.gold_price_per_gram ?? 0);

  return (
    <div>
      <PageHeader
        title="Appraisals"
        description="Record gold items, attach photos, and get a valuation and suggested loan range from today's gold price."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Appraisals" }]}
      />

      {canAppraise &&
        (goldPrice > 0 ? (
          <CreatePanel
            title="New appraisal"
            description="Valuation and counterfeit check run automatically when you save."
            defaultOpen={params.new === "1"}
          >
            <NewAppraisalForm
              customers={customers ?? []}
              defaultCustomerId={params.customer}
              goldPricePerGram={goldPrice}
              ltvPercent={Number(settings?.ltv_percent ?? 0)}
            />
          </CreatePanel>
        ) : (
          <Alert tone="warning" className="mb-6" title="Gold price not configured">
            An Admin must set the gold price in System Settings before items can be appraised.
          </Alert>
        ))}

      <Card padded={false}>
        <div className="border-b border-slate-200 p-4">
          <FilterTabs
            current={risk}
            tabs={[
              { label: "All appraisals", value: "all", href: "/dashboard/appraisals" },
              { label: "Awaiting counterfeit review", value: "pending", href: "/dashboard/appraisals?risk=pending", count: pendingCount ?? 0 },
            ]}
          />
        </div>
        {appraisals && appraisals.length > 0 ? (
          <>
            <Table>
              <THead>
                <TH>Item</TH>
                <TH>Customer</TH>
                <TH align="right">Value</TH>
                <TH align="right">Suggested loan</TH>
                <TH>Counterfeit check</TH>
                <TH>Date</TH>
              </THead>
              <TBody>
                {appraisals.map((a) => {
                  const pending = a.is_counterfeit_risk && a.counterfeit_resolution === "pending";
                  return (
                    <TR key={a.id} highlight={pending ? "danger" : undefined}>
                      <TD>
                        <TableLink href={`/dashboard/appraisals/${a.id}`}>
                          {a.weight_grams}g · {a.karat}k
                        </TableLink>
                      </TD>
                      <TD>{(a as unknown as { customers: { full_name: string } | null }).customers?.full_name ?? "—"}</TD>
                      <TD align="right">{formatPeso(a.computed_value)}</TD>
                      <TD align="right" className="text-slate-600">
                        {formatPeso(a.suggested_loan_min)} – {formatPeso(a.suggested_loan_max)}
                      </TD>
                      <TD>
                        {a.is_counterfeit_risk ? (
                          <StatusBadge
                            status={a.counterfeit_resolution ?? "pending"}
                            label={pending ? "Flagged — pending" : a.counterfeit_resolution === "cleared" ? "Cleared" : "Confirmed risk"}
                          />
                        ) : (
                          <StatusBadge status="cleared" label="Passed" />
                        )}
                      </TD>
                      <TD className="text-slate-600">{formatDate(a.created_at)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/dashboard/appraisals" params={{ risk: params.risk }} />
          </>
        ) : (
          <EmptyState
            icon="scale"
            title={risk === "pending" ? "No items awaiting review" : "No appraisals yet"}
            description={risk === "pending" ? "Every flagged item has been cleared or confirmed." : canAppraise ? "Record the first item using the form above." : undefined}
          />
        )}
      </Card>
    </div>
  );
}
