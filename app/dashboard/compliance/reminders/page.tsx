import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { daysUntilDue, isDueForReminder, REMINDER_LEAD_DAYS } from "@/lib/compliance/reminders";
import { manilaToday } from "@/lib/format";
import { Alert, Card, EmptyState, PageHeader, Table, TBody, TH, THead } from "@/components/ui";
import { ReminderRow } from "./reminder-row";

export const metadata = { title: "Due-date reminders" };

type LoanRow = {
  id: string;
  ticket_number: string;
  maturity_date: string;
  principal_balance: number;
  interest_owed: number;
  customers: { full_name: string; contact_number: string } | null;
};

export default async function RemindersPage() {
  await requireRole(["cashier", "admin"]);
  const today = manilaToday();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loans")
    .select("id, ticket_number, maturity_date, principal_balance, interest_owed, customers(full_name, contact_number)")
    .in("status", ["active", "extended"])
    .order("maturity_date");
  if (error) throw error;

  const dueLoans = ((data ?? []) as unknown as LoanRow[]).filter((l) => isDueForReminder(l.maturity_date, today));
  const dueLoanIds = dueLoans.map((l) => l.id);
  const { data: sentReminders } = dueLoanIds.length
    ? await supabase.from("reminder_log").select("loan_id").in("loan_id", dueLoanIds)
    : { data: [] };
  const sentSet = new Set((sentReminders ?? []).map((r) => r.loan_id));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Due-date reminders"
        description={`Loans maturing today or within the next ${REMINDER_LEAD_DAYS} days.`}
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Due-date reminders" }]}
      />

      <Alert tone="info">
        No SMS/email service is connected yet — call or text the customer, then click <strong>Mark reminded</strong> so the
        team knows it&apos;s been done.
      </Alert>

      <Card padded={false}>
        {dueLoans.length ? (
          <Table minWidth="720px">
            <THead>
              <TH>Customer</TH>
              <TH>Ticket</TH>
              <TH>Due</TH>
              <TH align="right">Owed</TH>
              <TH>Reminder</TH>
            </THead>
            <TBody>
              {dueLoans.map((loan) => (
                <ReminderRow
                  key={loan.id}
                  loanId={loan.id}
                  ticketNumber={loan.ticket_number}
                  customerName={loan.customers?.full_name ?? "—"}
                  contactNumber={loan.customers?.contact_number ?? ""}
                  maturityDate={loan.maturity_date}
                  daysLeft={daysUntilDue(loan.maturity_date, today)}
                  owed={Number(loan.principal_balance) + Number(loan.interest_owed)}
                  alreadySent={sentSet.has(loan.id)}
                />
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState icon="bell" title="No reminders due" description={`No open loans mature in the next ${REMINDER_LEAD_DAYS} days.`} />
        )}
      </Card>
    </div>
  );
}
