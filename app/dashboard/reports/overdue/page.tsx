import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { daysUntilDue } from "@/lib/compliance/reminders";
import { formatDate, formatPeso, manilaToday } from "@/lib/format";
import { ReportHeader } from "@/components/report-header";
import { Card, EmptyState, StatusBadge, Table, TBody, TD, TH, THead, TR, ActionsCell, ViewButton } from "@/components/ui";
import { accruedInterest } from "@/lib/loans/accrual";

export const metadata = { title: "Overdue loans report" };

type Row = {
  id: string;
  ticket_number: string;
  principal_balance: number;
  interest_owed: number;
  interest_rate_percent: number;
  interest_accrued_through: string | null;
  maturity_date: string;
  grace_period_days: number;
  status: string;
  customers: { full_name: string; contact_number: string } | null;
};

export default async function OverdueLoansReport() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const today = manilaToday();
  const { data, error } = await supabase
    .from("loans")
    .select("id, ticket_number, principal_balance, interest_owed, interest_rate_percent, interest_accrued_through, maturity_date, grace_period_days, status, customers(full_name, contact_number)")
    .in("status", ["active", "extended", "reinstated", "defaulted"])
    .is("archived_at", null)
    .lt("maturity_date", today)
    .order("maturity_date");
  if (error) throw error;
  const loans = (data ?? []) as unknown as Row[];
  const owed = (l: Row) => Number(l.principal_balance) + accruedInterest(l, today).interestOwed;
  const totalOwed = loans.reduce((s, l) => s + owed(l), 0);

  return (
    <div>
      <ReportHeader
        title="Overdue loans"
        description="Loans past their maturity date: within grace (collect or renew) or defaulted (forfeiture)."
        subtitle={`${loans.length} overdue loan${loans.length === 1 ? "" : "s"}, ${formatPeso(totalOwed)} owed as of ${formatDate(today)}`}
      />
      <Card padded={false}>
        {loans.length ? (
          <Table minWidth="760px">
            <THead>
              <TH>Customer</TH>
              <TH>Ticket</TH>
              <TH>Due</TH>
              <TH align="right">Days overdue</TH>
              <TH align="right">Owed</TH>
              <TH>Status</TH>
              <TH className="print:hidden">
                <span className="sr-only">Actions</span>
              </TH>
            </THead>
            <TBody>
              {loans.map((loan) => {
                const late = -daysUntilDue(loan.maturity_date, today);
                const inGrace = loan.status !== "defaulted" && loan.status !== "reinstated" && late <= loan.grace_period_days;
                return (
                  <TR key={loan.id} highlight={inGrace ? "warning" : "danger"}>
                    <TD>
                      {loan.customers?.full_name ?? ""}
                      <span className="block text-xs text-slate-500">{loan.customers?.contact_number}</span>
                    </TD>
                    <TD mono>{loan.ticket_number}</TD>
                    <TD>{formatDate(loan.maturity_date)}</TD>
                    <TD align="right" className="font-semibold">
                      {late}
                    </TD>
                    <TD align="right">{formatPeso(owed(loan))}</TD>
                    <TD>
                      {loan.status === "reinstated" ? (
                        <StatusBadge status="reinstated" />
                      ) : inGrace ? (
                        <StatusBadge status="pending" label={`In grace (${loan.grace_period_days - late}d left)`} />
                      ) : (
                        <StatusBadge status="defaulted" />
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
        ) : (
          <EmptyState title="No overdue loans." />
        )}
      </Card>
    </div>
  );
}
