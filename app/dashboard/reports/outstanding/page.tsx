import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPeso, manilaToday } from "@/lib/format";
import { ReportHeader } from "@/components/report-header";
import { Card, EmptyState, StatusBadge, Table, TBody, TD, TH, THead, TR, ActionsCell, ViewButton } from "@/components/ui";
import { accruedInterest } from "@/lib/loans/accrual";
import { categoryLabel } from "@/lib/appraisal/valuation";

export const metadata = { title: "Outstanding loans report" };

type Row = {
  id: string;
  ticket_number: string;
  principal_amount: number;
  principal_balance: number;
  interest_owed: number;
  interest_rate_percent: number;
  interest_accrued_through: string | null;
  maturity_date: string;
  status: string;
  customers: { full_name: string } | null;
  appraisal_items: { category: string; category_other: string | null; karat: number } | null;
};

export default async function OutstandingLoansReport() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loans")
    .select("id, ticket_number, principal_amount, principal_balance, interest_owed, interest_rate_percent, interest_accrued_through, maturity_date, status, customers(full_name), appraisal_items(category, category_other, karat)")
    .in("status", ["active", "extended", "reinstated"])
    .is("archived_at", null)
    .order("maturity_date");
  if (error) throw error;
  const today = manilaToday();
  // Interest includes periods accrued past maturity but not yet charged.
  const loans = ((data ?? []) as unknown as Row[]).map((l) => ({ ...l, interest_now: accruedInterest(l, today).interestOwed }));

  const totals = loans.reduce(
    (t, l) => ({
      principal: t.principal + Number(l.principal_amount),
      balance: t.balance + Number(l.principal_balance),
      interest: t.interest + l.interest_now,
    }),
    { principal: 0, balance: 0, interest: 0 },
  );

  return (
    <div>
      <ReportHeader
        title="Outstanding loans"
        description="Every open loan: who owes what and when it is due."
        subtitle={`${loans.length} open loan${loans.length === 1 ? "" : "s"}, ${formatPeso(totals.balance + totals.interest)} receivable as of ${formatDate(today)}`}
      />
      <Card padded={false}>
        {loans.length ? (
          <Table minWidth="760px">
            <THead>
              <TH>Customer</TH>
              <TH>Ticket</TH>
              <TH>Item</TH>
              <TH align="right">Principal</TH>
              <TH align="right">Balance</TH>
              <TH align="right">Interest owed</TH>
              <TH>Due</TH>
              <TH>Status</TH>
              <TH className="print:hidden">
                <span className="sr-only">Actions</span>
              </TH>
            </THead>
            <TBody>
              {loans.map((loan) => {
                const late = loan.maturity_date < today;
                return (
                  <TR key={loan.id} highlight={late ? "danger" : undefined}>
                    <TD>{loan.customers?.full_name ?? ""}</TD>
                    <TD mono>{loan.ticket_number}</TD>
                    <TD>{loan.appraisal_items ? `${categoryLabel(loan.appraisal_items.category, loan.appraisal_items.category_other)}, ${loan.appraisal_items.karat}K` : ""}</TD>
                    <TD align="right">{formatPeso(loan.principal_amount)}</TD>
                    <TD align="right">{formatPeso(loan.principal_balance)}</TD>
                    <TD align="right">{formatPeso(loan.interest_now)}</TD>
                    <TD>{formatDate(loan.maturity_date)}</TD>
                    <TD>{late ? <StatusBadge status="defaulted" label="Overdue" /> : <StatusBadge status={loan.status} label={loan.status === "extended" ? "Renewed" : undefined} />}</TD>
                    <ActionsCell>
                      <ViewButton href={`/dashboard/loans/${loan.id}`}>View loan</ViewButton>
                    </ActionsCell>
                  </TR>
                );
              })}
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                <TD>Total</TD>
                <TD />
                <TD />
                <TD align="right">{formatPeso(totals.principal)}</TD>
                <TD align="right">{formatPeso(totals.balance)}</TD>
                <TD align="right">{formatPeso(totals.interest)}</TD>
                <TD />
                <TD />
                <td className="print:hidden" />
              </tr>
            </TBody>
          </Table>
        ) : (
          <EmptyState title="No open loans." />
        )}
      </Card>
    </div>
  );
}
