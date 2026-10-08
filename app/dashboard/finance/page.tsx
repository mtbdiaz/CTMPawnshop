import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { computeCashPosition, computeRunningBalances } from "@/lib/finance/ledger";
import { formatDateTime, formatPeso, humanize, manilaDayStart } from "@/lib/format";
import {
  Card,
  EmptyState,
  PageHeader,
  Pagination,
  SectionTitle,
  StatCard,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  ActionsCell,
  Badge,
  ViewButton,
  pageParam,
} from "@/components/ui";
import { AdminEditCashEntryForm, CashEntryForm } from "./cash-entry-form";

export const metadata = { title: "Cash & ledger" };

const PAGE_SIZE = 30;

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireRole(["operator", "cashier", "admin"]);
  const isAdmin = user.profile.role === "admin";
  const page = pageParam((await searchParams).page);

  const supabase = await createClient();
  // The running balance depends on every earlier entry, so the full ledger is
  // loaded oldest-first (paged through PostgREST's row cap) and then shown
  // newest-first. Previously only the OLDEST 200 rows were loaded, which hid
  // all recent activity once the ledger grew past 200 entries.
  const all: NonNullable<Awaited<ReturnType<typeof fetchChunk>>["data"]> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await fetchChunk(supabase, from);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const todayStart = new Date(manilaDayStart()).getTime();
  const today = all.filter((e) => new Date(e.created_at).getTime() >= todayStart);
  const todayPosition = computeCashPosition(today);
  const overall = computeCashPosition(all);
  const balances = computeRunningBalances(all);

  const newestFirst = all.map((entry, i) => ({ entry, balance: balances[i] })).reverse();
  const pageRows = newestFirst.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cash & ledger"
        description="Loan disbursements, payments and renewals are logged automatically. Record any other expenses or income below."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Cash & ledger" }]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Cash in today" value={formatPeso(todayPosition.totalIn)} />
        <StatCard label="Cash out today" value={formatPeso(todayPosition.totalOut)} />
        <StatCard label="Net today" value={formatPeso(todayPosition.net)} tone={todayPosition.net < 0 ? "warning" : "gold"} />
        <StatCard label="Ledger balance" value={formatPeso(overall.net)} hint={`${all.length} entries all-time`} />
      </div>

      <Card>
        <SectionTitle description="For costs and income not tied to a loan (rent, utilities, supplies, other revenue).">
          Record expense or revenue
        </SectionTitle>
        <CashEntryForm />
      </Card>

      <section>
        <SectionTitle description="Newest first. Balance is the running total after each entry.">Ledger</SectionTitle>
        <Card padded={false}>
          {pageRows.length > 0 ? (
            <>
              <Table minWidth="860px">
                <THead>
                  <TH>Date</TH>
                  <TH>Type</TH>
                  <TH>Description</TH>
                  <TH align="right">In</TH>
                  <TH align="right">Out</TH>
                  <TH align="right">Balance</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </THead>
                <TBody>
                  {pageRows.map(({ entry, balance }) => (
                    <TR key={entry.id}>
                      <TD className="whitespace-nowrap text-slate-600">{formatDateTime(entry.created_at)}</TD>
                      <TD>{humanize(entry.entry_type)}</TD>
                      <TD>
                        {entry.description}
                        {entry.is_memo && (
                          <span className="ml-2">
                            <Badge tone="neutral">Memo, no cash</Badge>
                          </span>
                        )}
                      </TD>
                      <TD align="right" className="text-emerald-700">
                        {entry.direction === "in" && !entry.is_memo ? formatPeso(entry.amount) : ""}
                      </TD>
                      <TD align="right" className="text-red-700">
                        {entry.direction === "out" && !entry.is_memo ? formatPeso(entry.amount) : ""}
                      </TD>
                      <TD align="right" className="font-medium">
                        {formatPeso(balance)}
                      </TD>
                      <ActionsCell>
                        {entry.related_loan_id && <ViewButton href={`/dashboard/loans/${entry.related_loan_id}`}>View loan</ViewButton>}
                        {isAdmin && !entry.related_loan_id && (
                          <details className="text-left">
                            <summary className="cursor-pointer rounded-md border border-slate-300 px-2.5 py-1 text-sm">Edit (Admin)</summary>
                            <div className="mt-2 w-64">
                              <AdminEditCashEntryForm id={entry.id} amount={Number(entry.amount)} description={entry.description ?? ""} />
                            </div>
                          </details>
                        )}
                      </ActionsCell>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination page={page} pageSize={PAGE_SIZE} total={all.length} basePath="/dashboard/finance" />
            </>
          ) : (
            <EmptyState title="No cash entries yet." description="Entries appear as loans are issued and paid." />
          )}
        </Card>
      </section>
    </div>
  );
}

function fetchChunk(supabase: Awaited<ReturnType<typeof createClient>>, from: number) {
  return supabase
    .from("cash_flow_entries")
    .select("id, created_at, entry_type, description, direction, amount, related_loan_id, is_memo")
    .is("archived_at", null)
    .order("created_at")
    .order("id")
    .range(from, from + 999);
}
