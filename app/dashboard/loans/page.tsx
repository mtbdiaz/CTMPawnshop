import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPeso, manilaToday } from "@/lib/format";
import {
  Card,
  CreatePanel,
  EmptyState,
  FilterTabs,
  PageHeader,
  Pagination,
  SearchBar,
  SortTH,
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
import type { Enums } from "@/lib/supabase/database.types";
import { NewLoanForm } from "./new-loan-form";
import { runDefaultDetection } from "./actions";

export const metadata = { title: "Loans" };

const PAGE_SIZE = 25;
const STATUS_FILTERS: Record<string, { label: string; statuses: Enums<"loan_status">[] }> = {
  open: { label: "Open", statuses: ["active", "extended"] },
  overdue: { label: "Overdue", statuses: ["active", "extended"] },
  redeemed: { label: "Redeemed", statuses: ["redeemed"] },
  defaulted: { label: "Defaulted / forfeited", statuses: ["defaulted", "forfeited"] },
  all: { label: "All", statuses: [] },
};
const SORTS: Record<string, string> = { due: "maturity_date", issued: "created_at", principal: "principal_amount" };

export default async function LoansPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; sort?: string; dir?: string; new?: string; customer?: string; item?: string }>;
}) {
  const user = await requireRole(["cashier", "operator", "appraiser", "admin"]);
  // PB-21: opportunistic default detection on page load (see DECISIONS_LOG.md).
  await runDefaultDetection();

  const params = await searchParams;
  const status = STATUS_FILTERS[params.status ?? ""] ? params.status! : "open";
  const q = params.q?.trim();
  const page = pageParam(params.page);
  const sort = SORTS[params.sort ?? ""] ? params.sort! : status === "open" || status === "overdue" ? "due" : "issued";
  const dir = params.dir === "asc" || params.dir === "desc" ? params.dir : sort === "due" ? "asc" : "desc";
  const canCreate = hasRole(user.profile.role, ["cashier"]);
  const today = manilaToday();

  const supabase = await createClient();

  let customerIds: string[] = [];
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    const { data: matches } = await supabase.from("customers").select("id").ilike("full_name", `%${safe}%`).limit(200);
    customerIds = (matches ?? []).map((c) => c.id);
  }

  let query = supabase
    .from("loans")
    .select("*, customers(full_name)", { count: "exact" })
    .order(SORTS[sort], { ascending: dir === "asc" })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const statuses = STATUS_FILTERS[status].statuses;
  if (statuses.length) query = query.in("status", statuses);
  if (status === "overdue") query = query.lt("maturity_date", today);
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    query = customerIds.length
      ? query.or(`ticket_number.ilike.%${safe}%,customer_id.in.(${customerIds.join(",")})`)
      : query.ilike("ticket_number", `%${safe}%`);
  }

  const [{ data: loans, count, error }, formData] = await Promise.all([
    query,
    canCreate ? loadNewLoanData(supabase, params.customer) : Promise.resolve(null),
  ]);
  if (error) throw error;

  const listParams = { status: params.status, q, sort: params.sort, dir: params.dir };
  const tabHref = (value: string) => {
    const qs = new URLSearchParams();
    if (value !== "open") qs.set("status", value);
    if (q) qs.set("q", q);
    const s = qs.toString();
    return s ? `/dashboard/loans?${s}` : "/dashboard/loans";
  };

  return (
    <div>
      <PageHeader
        title="Pawn loans"
        description="Issue pawn tickets, then open a ticket to record payments, renew, or redeem."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Loans" }]}
      />

      {canCreate && formData && (
        <CreatePanel
          title="New pawn loan"
          description="Creates the loan, registers the item in the vault, and logs the cash disbursement."
          defaultOpen={params.new === "1"}
        >
          <NewLoanForm items={formData.items} defaultItemId={params.item} interestRatePercent={formData.interestRate} />
        </CreatePanel>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <FilterTabs
            current={status}
            tabs={Object.entries(STATUS_FILTERS).map(([value, f]) => ({ value, label: f.label, href: tabHref(value) }))}
          />
          <SearchBar action="/dashboard/loans" defaultValue={q} placeholder="Ticket # or customer name…" hidden={{ status: params.status }} />
        </div>
        {loans && loans.length > 0 ? (
          <>
            <Table minWidth="760px">
              <THead>
                <TH>Ticket</TH>
                <TH>Customer</TH>
                <SortTH label="Principal" column="principal" current={sort} dir={dir} basePath="/dashboard/loans" params={listParams} align="right" />
                <TH align="right">Owed now</TH>
                <SortTH label="Due" column="due" current={sort} dir={dir} basePath="/dashboard/loans" params={listParams} />
                <TH>Status</TH>
              </THead>
              <TBody>
                {loans.map((loan) => {
                  const open = loan.status === "active" || loan.status === "extended";
                  const late = open && loan.maturity_date < today;
                  return (
                    <TR key={loan.id} highlight={late ? "danger" : undefined}>
                      <TD mono>
                        <TableLink href={`/dashboard/loans/${loan.id}`}>{loan.ticket_number}</TableLink>
                      </TD>
                      <TD>{(loan as unknown as { customers: { full_name: string } | null }).customers?.full_name ?? "—"}</TD>
                      <TD align="right">{formatPeso(loan.principal_amount)}</TD>
                      <TD align="right" className="font-medium">
                        {open ? formatPeso(Number(loan.principal_balance) + Number(loan.interest_owed)) : "—"}
                      </TD>
                      <TD>
                        {formatDate(loan.maturity_date)}
                        {late && <span className="ml-1 text-xs font-semibold text-red-700">overdue</span>}
                      </TD>
                      <TD>
                        <StatusBadge status={loan.status} label={loan.status === "extended" ? "Renewed" : undefined} />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/dashboard/loans" params={listParams} />
          </>
        ) : (
          <EmptyState
            icon="ticket"
            title={q ? "No loans match your search" : status === "overdue" ? "No overdue loans" : `No ${STATUS_FILTERS[status].label.toLowerCase()} loans`}
            description={q ? "Try the full ticket number, or search the customer's name." : undefined}
          />
        )}
      </Card>
    </div>
  );
}

async function loadNewLoanData(supabase: Awaited<ReturnType<typeof createClient>>, customerId?: string) {
  let appraisalQuery = supabase
    .from("appraisal_items")
    .select("id, customer_id, weight_grams, karat, suggested_loan_min, suggested_loan_max, is_counterfeit_risk, counterfeit_resolution, customers(full_name, is_blacklisted)")
    .order("created_at", { ascending: false });
  if (customerId) appraisalQuery = appraisalQuery.eq("customer_id", customerId);

  const [{ data: appraisals }, { data: activeLoans }, { data: settings }] = await Promise.all([
    appraisalQuery,
    supabase.from("loans").select("appraisal_item_id"),
    supabase.from("system_settings").select("interest_rate_percent").eq("id", 1).maybeSingle(),
  ]);

  // Each pawn transaction needs its own appraisal at the current gold price, so
  // an item that has ever had a loan (open, redeemed or forfeited) isn't offered.
  const usedItemIds = new Set((activeLoans ?? []).map((l) => l.appraisal_item_id));
  const items = (appraisals ?? [])
    .filter((a) => {
      const customer = (a as unknown as { customers: { is_blacklisted: boolean } | null }).customers;
      return (
        !usedItemIds.has(a.id) &&
        !(a.is_counterfeit_risk && a.counterfeit_resolution !== "cleared") &&
        !customer?.is_blacklisted
      );
    })
    .map((a) => ({
      id: a.id,
      customer_id: a.customer_id,
      customer_name: (a as unknown as { customers: { full_name: string } | null }).customers?.full_name ?? "—",
      weight_grams: a.weight_grams,
      karat: a.karat,
      suggested_loan_min: a.suggested_loan_min,
      suggested_loan_max: a.suggested_loan_max,
    }));

  return { items, interestRate: Number(settings?.interest_rate_percent ?? 0) };
}
