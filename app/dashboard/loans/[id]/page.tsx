import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { calculateInterestDue } from "@/lib/loans/calculations";
import { PrintButton } from "@/components/print-button";
import { PaymentForm, ExtensionForm } from "./payment-form";

export default async function LoanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["cashier", "operator", "appraiser", "admin"]);
  const { id } = await params;

  const supabase = await createClient();
  const { data: loan } = await supabase
    .from("loans")
    .select("*, customers(full_name, address, contact_number), appraisal_items(weight_grams, karat, purity_percent)")
    .eq("id", id)
    .single();
  if (!loan) notFound();

  const { data: payments } = await supabase
    .from("loan_payments")
    .select("*")
    .eq("loan_id", id)
    .order("created_at", { ascending: false });

  const customer = (loan as unknown as { customers: { full_name: string; address: string; contact_number: string } | null }).customers;
  const item = (loan as unknown as { appraisal_items: { weight_grams: number; karat: number; purity_percent: number } | null }).appraisal_items;
  const interestDue = calculateInterestDue(loan.principal_balance, loan.interest_rate_percent);
  const canTransact = loan.status === "active" || loan.status === "extended";

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Pawn Ticket {loan.ticket_number}</h1>
        <PrintButton label="Print ticket" />
      </div>

      <div id="pawn-ticket" className="rounded-md border border-slate-200 bg-white p-6 text-sm">
        <h2 className="text-base font-semibold">CTM Pawnshop — Pawn Ticket</h2>
        <p className="text-slate-500">Ticket #: {loan.ticket_number}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div>
            <div className="text-slate-500">Customer</div>
            <div>{customer?.full_name}</div>
            <div className="text-xs text-slate-500">{customer?.address}</div>
            <div className="text-xs text-slate-500">{customer?.contact_number}</div>
          </div>
          <div>
            <div className="text-slate-500">Item</div>
            <div>
              {item?.weight_grams}g, {item?.karat}k, {item?.purity_percent}% purity
            </div>
          </div>
          <div>
            <div className="text-slate-500">Principal amount</div>
            <div>₱{loan.principal_amount.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-slate-500">Interest rate</div>
            <div>{loan.interest_rate_percent}% / month</div>
          </div>
          <div>
            <div className="text-slate-500">Loan date</div>
            <div>{loan.loan_date}</div>
          </div>
          <div>
            <div className="text-slate-500">Maturity date</div>
            <div>{loan.maturity_date}</div>
          </div>
          <div>
            <div className="text-slate-500">Current balance</div>
            <div>₱{loan.principal_balance.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-slate-500">Status</div>
            <div className="capitalize">{loan.status}</div>
          </div>
        </div>
      </div>

      {canTransact && (
        <div className="print:hidden space-y-4">
          <PaymentForm loanId={loan.id} interestDue={interestDue} />
          <ExtensionForm loanId={loan.id} />
        </div>
      )}

      <section className="print:hidden">
        <h2 className="text-sm font-medium text-slate-900">Payment history</h2>
        <table className="mt-2 w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase text-slate-500">
              <th className="pb-2 pr-4">Receipt</th>
              <th className="pb-2 pr-4">Amount</th>
              <th className="pb-2 pr-4">Interest</th>
              <th className="pb-2 pr-4">Principal</th>
              <th className="pb-2 pr-4">Date</th>
            </tr>
          </thead>
          <tbody>
            {payments?.length ? (
              payments.map((p) => (
                <tr key={p.id} className="border-t border-slate-200">
                  <td className="py-2 pr-4">{p.receipt_number}</td>
                  <td className="py-2 pr-4">₱{p.amount.toLocaleString()}</td>
                  <td className="py-2 pr-4">₱{p.interest_portion.toLocaleString()}</td>
                  <td className="py-2 pr-4">₱{p.principal_portion.toLocaleString()}</td>
                  <td className="py-2 pr-4">{new Date(p.created_at).toLocaleDateString()}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="py-4 text-sm text-slate-500">
                  No payments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
