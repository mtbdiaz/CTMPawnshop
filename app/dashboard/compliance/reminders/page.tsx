import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { isDueForReminder } from "@/lib/compliance/reminders";
import { ReminderRow } from "./reminder-row";

export default async function RemindersPage() {
  await requireRole(["cashier", "admin"]);

  const supabase = await createClient();
  const { data: loans } = await supabase
    .from("loans")
    .select("id, maturity_date, customers(full_name)")
    .in("status", ["active", "extended"]);

  const dueLoans = (loans ?? []).filter((l) => isDueForReminder(new Date(l.maturity_date)));
  const dueLoanIds = dueLoans.map((l) => l.id);

  const { data: sentReminders } = dueLoanIds.length
    ? await supabase.from("reminder_log").select("loan_id").in("loan_id", dueLoanIds)
    : { data: [] };
  const sentSet = new Set((sentReminders ?? []).map((r) => r.loan_id));

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Due-Date Reminders</h1>
      <p className="mt-1 text-sm text-slate-500">
        Loans maturing within the next few days. No email/SMS provider is configured in this
        environment — reminders are logged here for reference (see DECISIONS_LOG.md).
      </p>

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500">
            <th className="pb-2 pr-4">Customer</th>
            <th className="pb-2 pr-4">Maturity date</th>
            <th className="pb-2 pr-4">Action</th>
          </tr>
        </thead>
        <tbody>
          {dueLoans.length ? (
            dueLoans.map((loan) => (
              <ReminderRow
                key={loan.id}
                loanId={loan.id}
                customerName={(loan as unknown as { customers: { full_name: string } | null }).customers?.full_name ?? "—"}
                maturityDate={loan.maturity_date}
                alreadySent={sentSet.has(loan.id)}
              />
            ))
          ) : (
            <tr>
              <td colSpan={3} className="py-4 text-sm text-slate-500">
                No loans due for a reminder right now.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
