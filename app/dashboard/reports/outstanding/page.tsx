import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPeso, manilaToday } from "@/lib/format";
import { ReportHeader } from "@/components/report-header";
import { Card, EmptyState, StatusBadge, Table, TBody, TD, TH, THead, TR, TableLink } from "@/components/ui";

export const metadata = { title: "Outstanding loans report" };

type Row = {
  id: string;
  ticket_number: string;
  principal_amount: number;
  principal_balance: number;
  interest_owed: number;
  maturity_date: string;
  status: string;
  customers: { full_name: string } | null;
};

export default async function OutstandingLoansReport() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loans")
    .select("id, ticket_number, principal_amount, principal_balance, interest_owed, maturity_date, status, customers(full_name)")
    .in("status", ["active", "extended"])
    .order("maturity_date");
  if (error) throw error;
  const loans = (data ?? []) as unknown as Row[];
  const today = manilaToday();

  const totals = loans.reduce(
    (t, l) => ({
      principal: t.principal + Number(l.principal_amount),
      balance: t.balance + Number(l.principal_balance),
      interest: t.interest + Number(l.interest_owed),
    }),
    { principal: 0, balance: 0, interest: 0 },
  );

  return (
    <div>
      <ReportHeader
        title="Outstanding loans"
        description="Every open loan — who owes what, and when it's due."
        subtitle={`${loans.length} open loan${loans.length === 1 ? "" : "s"} · ${formatPeso(totals.balance + totals.interest)} receivable`}
      />
      <Card padded={false}>
        {loans.length ? (
          <Table minWidth="760px">
            <THead>
              <TH>Customer</TH>
              <TH>Ticket</TH>
              <TH align="right">Principal</TH>
              <TH align="right">Balance</TH>
              <TH align="right">Interest owed</TH>
              <TH>Due</TH>
              <TH>Status</TH>
            </THead>
            <TBody>
              {loans.map((loan) => {
                const late = loan.maturity_date < today;
                return (
                  <TR key={loan.id} highlight={late ? "danger" : undefined}>
                    <TD>{loan.customers?.full_name ?? "—"}</TD>
                    <TD mono>
                      <TableLink href={`/dashboard/loans/${loan.id}`}>{loan.ticket_number}</TableLink>
                    </TD>
                    <TD align="right">{formatPeso(loan.principal_amount)}</TD>
                    <TD align="right">{formatPeso(loan.principal_balance)}</TD>
                    <TD align="right">{formatPeso(loan.interest_owed)}</TD>
                    <TD>{formatDate(loan.maturity_date)}</TD>
                    <TD>{late ? <StatusBadge status="defaulted" label="Overdue" /> : <StatusBadge status={loan.status} label={loan.status === "extended" ? "Renewed" : undefined} />}</TD>
                  </TR>
                );
              })}
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                <TD>Total</TD>
                <TD />
                <TD align="right">{formatPeso(totals.principal)}</TD>
                <TD align="right">{formatPeso(totals.balance)}</TD>
                <TD align="right">{formatPeso(totals.interest)}</TD>
                <TD />
                <TD />
              </tr>
            </TBody>
          </Table>
        ) : (
          <EmptyState icon="ticket" title="No open loans" />
        )}
      </Card>
    </div>
  );
}
