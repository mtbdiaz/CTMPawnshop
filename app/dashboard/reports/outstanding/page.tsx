import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/print-button";

export default async function OutstandingLoansReport() {
  await requireRole(["admin"]);

  const supabase = await createClient();
  const { data: loans } = await supabase
    .from("loans")
    .select("*, customers(full_name)")
    .in("status", ["active", "extended"])
    .order("maturity_date");

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Outstanding Loans Report</h1>
        <PrintButton />
      </div>
      <p className="mt-1 text-sm text-slate-500 print:hidden">
        Every currently active loan — who owes what, and when it&apos;s due.
      </p>

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500">
            <th className="pb-2 pr-4">Customer</th>
            <th className="pb-2 pr-4">Ticket</th>
            <th className="pb-2 pr-4">Principal</th>
            <th className="pb-2 pr-4">Balance</th>
            <th className="pb-2 pr-4">Due date</th>
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
                <td className="py-2 pr-4">₱{loan.principal_amount.toLocaleString()}</td>
                <td className="py-2 pr-4">₱{loan.principal_balance.toLocaleString()}</td>
                <td className="py-2 pr-4">{loan.maturity_date}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="py-4 text-sm text-slate-500">
                No active loans.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
