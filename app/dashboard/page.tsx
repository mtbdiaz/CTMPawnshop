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
  const overdue = loans.filter((l) => daysUntilDue(l.maturity_date, today) < 0);
  const dueSoon = loans.filter((l) => {
    const days = daysUntilDue(l.maturity_date, today);
    return days >= 0 && days <= 7;
  });
  const owedNow = (l: LoanRow) => Number(l.principal_balance) + accruedInterest(l, today).interestOwed;
  const outstanding = loans.reduce((sum, l) => sum + owedNow(l), 0);
  const cash = computeCashPosition(todayCash ?? []);
  const attention = [...overdue, ...dueSoon].slice(0, 8);

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
        <SectionTitle description="Overdue loans first, then loans due within 7 days.">Needs attention</SectionTitle>
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
                  const late = -daysUntilDue(loan.maturity_date, today);
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
                        <StatusBadge status={late > 0 ? "defaulted" : loan.status} label={late > 0 ? "Overdue" : loan.status === "extended" ? "Renewed" : undefined} />
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
        </Card>
      </section>

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
