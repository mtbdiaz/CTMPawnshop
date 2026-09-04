import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/print-button";
import { daysOverdue } from "@/lib/reports/loans";

export default async function OverdueLoansReport() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data: loans } = await supabase
    .from("loans")
    .select("*, customers(full_name)")
    .in("status", ["active", "extended", "defaulted"])
    .lt("maturity_date", today)
    .order("maturity_date");

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Overdue Loans Report</h1>
        <PrintButton />
      </div>
      <p className="mt-1 text-sm text-slate-500 print:hidden">
        Loans past their due date, for collections follow-up or forfeiture proceedings.
      </p>

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500">
            <th className="pb-2 pr-4">Customer</th>
            <th className="pb-2 pr-4">Ticket</th>
            <th className="pb-2 pr-4">Balance</th>
            <th className="pb-2 pr-4">Due date</th>
            <th className="pb-2 pr-4">Days overdue</th>
            <th className="pb-2 pr-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {loans?.length ? (
            loans.map((loan) => (
              <tr key={loan.id} className="border-t border-slate-200">
                <td className="py-2 pr-4">
                  {(loan as unknown as { customers: { full_name: string } | null }).customers?.full_name ?? "—"}
                </td>
                <td className="py-2 pr-4">{loan.ticket_number}</td>
                <td className="py-2 pr-4">₱{loan.principal_balance.toLocaleString()}</td>
                <td className="py-2 pr-4">{loan.maturity_date}</td>
                <td className="py-2 pr-4">{daysOverdue(new Date(loan.maturity_date))}</td>
                <td className="py-2 pr-4 capitalize">{loan.status}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="py-4 text-sm text-slate-500">
                No overdue loans.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
