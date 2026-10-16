import { getCurrentUser } from "@/lib/auth/session";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { computeCashPosition } from "@/lib/finance/ledger";
import { daysUntilDue } from "@/lib/compliance/reminders";
import { formatDate, formatPeso, manilaDayStart, manilaToday } from "@/lib/format";
import { accruedInterest } from "@/lib/loans/accrual";
import {
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  SectionTitle,
  StatCard,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  ActionsCell,
  ViewButton,
} from "@/components/ui";

export const metadata = { title: "Dashboard" };

type LoanRow = {
  id: string;
  ticket_number: string;
  maturity_date: string;
  principal_balance: number;
  interest_owed: number;
  interest_rate_percent: number;
  interest_accrued_through: string | null;
  status: string;
  customers: { full_name: string } | null;
};

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const role = user.profile.role;
  const supabase = await createClient();

  const canSeeCash = hasRole(role, ["operator", "cashier"]);

  const [{ data: openLoans }, { data: todayCash }, { count: pendingFlags }, { count: openSuspicious }, { count: customerCount }] =
    await Promise.all([
      supabase
        .from("loans")
        .select("id, ticket_number, maturity_date, principal_balance, interest_owed, interest_rate_percent, interest_accrued_through, status, customers(full_name)")
        .in("status", ["active", "extended", "reinstated"])
        .is("archived_at", null)
        .order("maturity_date"),
      canSeeCash
        ? supabase.from("cash_flow_entries").select("amount, direction, is_memo").is("archived_at", null).gte("created_at", manilaDayStart())
        : Promise.resolve({ data: [] as { amount: number; direction: "in" | "out"; is_memo: boolean }[] }),
      supabase
        .from("appraisal_items")
        .select("id", { count: "exact", head: true })
        .eq("is_counterfeit_risk", true)
        .eq("counterfeit_resolution", "pending")
        .is("archived_at", null),
      role === "admin"
        ? supabase.from("suspicious_activity_flags").select("id", { count: "exact", head: true }).eq("status", "open")
        : Promise.resolve({ count: 0 }),
      supabase.from("customers").select("id", { count: "exact", head: true }).is("archived_at", null),
    ]);

  const loans = (openLoans ?? []) as unknown as LoanRow[];
  const now = new Date();
  const today = manilaToday(now);
  // What the customer owes today: principal left + interest
  // (including interest that piled up after the due date).
  // Moved to the top so the lines below can use it.
  const owedNow = (l: LoanRow) => Number(l.principal_balance) + accruedInterest(l, today).interestOwed;

  // D1: a loan with nothing left to pay is "paid, ready to release".
  // We check "less than 1 centavo" instead of "equals 0" because
  // computers can leave tiny leftovers like 0.0000001 when adding decimals.
  const isPaid = (l: LoanRow) => owedNow(l) < 0.01;

  // All paid loans whose item is still in the vault
  const readyToRelease = loans.filter(isPaid);

  // Overdue = past the due date AND still owes money.
  // "!isPaid(l)" means "not paid" (the ! flips true/false).
  const overdue = loans.filter((l) => !isPaid(l) && daysUntilDue(l.maturity_date, today) < 0);

  // Due soon = due today or within 7 days, and still owes money
  const dueSoon = loans.filter((l) => {
    if (isPaid(l)) return false; // paid loans are never "due soon"
    const days = daysUntilDue(l.maturity_date, today);
    return days >= 0 && days <= 7;
  });

  // Total still owed across all open loans (paid ones add ₱0)
  const outstanding = loans.reduce((sum, l) => sum + owedNow(l), 0);
  const cash = computeCashPosition(todayCash ?? []);

  // Needs attention list order: paid first (quick to finish at the counter),
  // then overdue, then due soon. ".slice(0, 8)" keeps only the first 8.
  // D3: keep the FULL list too, so we know if some got cut off
  const attentionAll = [...readyToRelease, ...overdue, ...dueSoon];
  // Only the first 8 are shown in the table
  const attention = attentionAll.slice(0, 8);

  // D5: defaulted loans (grace period ended, not fully paid).
  // Only an Admin can forfeit, so only Admin asks the database for them.
  // "condition ? A : B" = if Admin, run the query (A); otherwise use an empty list (B).
  const { data: defaultedRows } =
    role === "admin"
      ? await supabase
          .from("loans") // the loans table
          .select("id, ticket_number, maturity_date, defaulted_at, principal_balance, interest_owed, interest_rate_percent, interest_accrued_through, status, customers(full_name)") // columns we need, plus the customer's name
          .eq("status", "defaulted") // only defaulted loans
          .is("archived_at", null) // skip archived ones
          .order("defaulted_at") // oldest default first
      : { data: [] };

  // Tell TypeScript each row looks like a LoanRow plus a defaulted_at date.
  // "?? []" means: if the database gave back nothing, use an empty list.
  const waitingForfeit = (defaultedRows ?? []) as unknown as (LoanRow & { defaulted_at: string | null })[];

  const primary = hasRole(role, ["cashier"])
    ? { href: "/dashboard/loans/new", label: "New loan" }
    : hasRole(role, ["appraiser"])
      ? { href: "/dashboard/appraisals?new=1", label: "New appraisal" }
      : hasRole(role, ["operator"])
        ? { href: "/dashboard/customers?new=1", label: "Register customer" }
        : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        actions={
          primary ? (
            <ButtonLink href={primary.href} variant="primary">
              {primary.label}
            </ButtonLink>
          ) : undefined
        }
      />

      {(pendingFlags ?? 0) > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span>
            <strong>{pendingFlags}</strong> appraisal{pendingFlags === 1 ? "" : "s"} flagged as possible counterfeit
            {role === "admin" ? ". Awaiting your review." : ". Waiting on an Admin."}
          </span>
          <ButtonLink href="/dashboard/appraisals?risk=pending" size="sm">
            Review flags
          </ButtonLink>
        </div>
      )}
      {(openSuspicious ?? 0) > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            <strong>{openSuspicious}</strong> suspicious-activity flag{openSuspicious === 1 ? "" : "s"} open.
          </span>
          <ButtonLink href="/dashboard/compliance" size="sm">
            Review
          </ButtonLink>
        </div>
      )}

      <section>
        <SectionTitle description="Paid loans waiting to be released, then overdue loans, then loans due within 7 days.">Needs attention</SectionTitle>
        <Card padded={false}>
          {attention.length === 0 ? (
            <EmptyState title="Nothing overdue or due in the next 7 days." />
          ) : (
            <Table minWidth="640px">
              <THead>
                <TH>Ticket</TH>
                <TH>Customer</TH>
                <TH>Due</TH>
                <TH align="right">Owed now</TH>
                <TH>Status</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </THead>
              <TBody>
                {attention.map((loan) => {
                  // paid = nothing left to pay. A paid loan is never "late",
                  // so it won't get the red row or the "(1d late)" text.
                  const paid = isPaid(loan);
                  const late = paid ? 0 : -daysUntilDue(loan.maturity_date, today);
                  return (
                    <TR key={loan.id} highlight={late > 0 ? "danger" : undefined}>
                      <TD mono>{loan.ticket_number}</TD>
                      <TD>{loan.customers?.full_name ?? ""}</TD>
                      <TD>
                        {formatDate(loan.maturity_date)}
                        {late > 0 && <span className="ml-1 text-xs font-semibold text-red-700">({late}d late)</span>}
                      </TD>
                      <TD align="right">{formatPeso(owedNow(loan))}</TD>
                      <TD>
                        {/* Paid loans get a green badge telling the cashier to release the item.
                            status="redeemed" borrows the green color already used for redeemed loans. */}
                        {paid ? (
                          <StatusBadge status="redeemed" label="Paid, ready to release" />
                        ) : (
                          <StatusBadge status={late > 0 ? "defaulted" : loan.status} label={late > 0 ? "Overdue" : loan.status === "extended" ? "Renewed" : undefined} />
                        )}
                      </TD>
                      <ActionsCell>
                        <ViewButton href={`/dashboard/loans/${loan.id}`}>View loan</ViewButton>
                      </ActionsCell>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}

          {/* D3: only shows when some loans were cut off.
              "condition && (...)" means: show the part in brackets only if the condition is true. */}
          {attentionAll.length > attention.length && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
              <span>
                Showing {attention.length} of {attentionAll.length}.
              </span>
              <ButtonLink href="/dashboard/loans?status=open" size="sm">
                View all open loans
              </ButtonLink>
            </div>
          )}
        </Card>
      </section>

      {/* D5: Admin-only list of defaulted loans. Hidden when there are none. */}
      {waitingForfeit.length > 0 && (
        <section>
          <SectionTitle description="Grace period ended without full payment. Open each loan to forfeit it.">Waiting for forfeit</SectionTitle>
          <Card padded={false}>
            <Table minWidth="640px">
              <THead>
                <TH>Ticket</TH>
                <TH>Customer</TH>
                <TH>Due</TH>
                <TH>Defaulted</TH>
                <TH align="right">Owed now</TH>
                <TH>
                  {/* sr-only = hidden on screen, read out by screen readers */}
                  <span className="sr-only">Actions</span>
                </TH>
              </THead>
              <TBody>
                {/* .map() makes one table row for each defaulted loan */}
                {waitingForfeit.map((loan) => (
                  <TR key={loan.id} highlight="danger">
                    <TD mono>{loan.ticket_number}</TD>
                    <TD>{loan.customers?.full_name ?? ""}</TD>
                    <TD>{formatDate(loan.maturity_date)}</TD>
                    <TD>{formatDate(loan.defaulted_at)}</TD>
                    <TD align="right">{formatPeso(owedNow(loan))}</TD>
                    <ActionsCell>
                      <ViewButton href={`/dashboard/loans/${loan.id}`}>View loan</ViewButton>
                    </ActionsCell>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </section>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open loans" value={loans.length} hint={`${formatPeso(outstanding)} outstanding`} href="/dashboard/loans?status=open" />
        <StatCard
          label="Overdue"
          value={overdue.length}
          tone={overdue.length ? "danger" : "default"}
          href={role === "admin" ? "/dashboard/reports/overdue" : "/dashboard/loans?status=overdue"}
        />
        <StatCard
          label="Due in 7 days"
          value={dueSoon.length}
          tone={dueSoon.length ? "warning" : "default"}
          href={hasRole(role, ["cashier"]) ? "/dashboard/compliance/reminders" : "/dashboard/loans?status=open"}
        />
        {canSeeCash ? (
          <StatCard label="Net cash today" value={formatPeso(cash.net)} hint={`${formatPeso(cash.totalIn)} in, ${formatPeso(cash.totalOut)} out`} href="/dashboard/finance" />
        ) : (
          <StatCard label="Customers on file" value={customerCount ?? 0} href="/dashboard/customers" />
        )}
      </div>
    </div>
  );
}
