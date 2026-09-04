import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { NewLoanForm } from "./new-loan-form";

export default async function LoansPage() {
  await requireRole(["cashier", "operator", "appraiser", "admin"]);

  const supabase = await createClient();
  const [{ data: appraisals }, { data: activeLoans }, { data: loans }] = await Promise.all([
    supabase.from("appraisal_items").select("*, customers(full_name)"),
    supabase.from("loans").select("appraisal_item_id").in("status", ["active", "extended"]),
    supabase
      .from("loans")
      .select("*, customers(full_name)")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const loanedItemIds = new Set((activeLoans ?? []).map((l) => l.appraisal_item_id));
  const availableItems = (appraisals ?? [])
    .filter((a) => !loanedItemIds.has(a.id) && !(a.is_counterfeit_risk && a.counterfeit_resolution !== "cleared"))
    .map((a) => ({
      id: a.id,
      customer_id: a.customer_id,
      customer_name: (a as unknown as { customers: { full_name: string } | null }).customers?.full_name ?? "—",
      weight_grams: a.weight_grams,
      karat: a.karat,
      suggested_loan_max: a.suggested_loan_max,
    }));

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Pawn Loans &amp; Transactions</h1>
      <p className="mt-1 text-sm text-slate-500">
        Create a loan against an appraised item, issue the pawn ticket, and manage payments and
        extensions.
      </p>

      <details className="mt-6 rounded-md border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium text-slate-900">New loan</summary>
        <div className="mt-4">
          <NewLoanForm items={availableItems} />
        </div>
      </details>

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500">
            <th className="pb-2 pr-4">Ticket</th>
            <th className="pb-2 pr-4">Customer</th>
            <th className="pb-2 pr-4">Principal</th>
            <th className="pb-2 pr-4">Balance</th>
            <th className="pb-2 pr-4">Maturity</th>
            <th className="pb-2 pr-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {loans?.length ? (
            loans.map((loan) => (
              <tr key={loan.id} className="border-t border-slate-200">
                <td className="py-2 pr-4">
                  <Link href={`/dashboard/loans/${loan.id}`} className="hover:underline">
                    {loan.ticket_number}
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  {(loan as unknown as { customers: { full_name: string } | null }).customers
                    ?.full_name ?? "—"}
                </td>
                <td className="py-2 pr-4">₱{loan.principal_amount.toLocaleString()}</td>
                <td className="py-2 pr-4">₱{loan.principal_balance.toLocaleString()}</td>
                <td className="py-2 pr-4">{loan.maturity_date}</td>
                <td className="py-2 pr-4">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                    {loan.status}
                  </span>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="py-4 text-sm text-slate-500">
                No loans yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
