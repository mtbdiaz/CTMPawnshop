import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { updateCustomer } from "../actions";
import { CustomerForm } from "../customer-form";
import { BlacklistForm } from "./blacklist-form";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole(["operator", "cashier", "appraiser", "admin"]);
  const { id } = await params;

  const supabase = await createClient();
  const { data: customer } = await supabase.from("customers").select("*").eq("id", id).single();
  if (!customer) notFound();

  // PB-10: real transaction history — every loan for this customer plus its
  // payments and extensions, newest first.
  const { data: loans } = await supabase
    .from("loans")
    .select(
      "id, ticket_number, principal_amount, status, loan_date, maturity_date, extension_count, loan_payments(id, amount, receipt_number, created_at), loan_extensions(id, new_maturity_date, additional_interest_amount, created_at)",
    )
    .eq("customer_id", id)
    .order("loan_date", { ascending: false });

  type LoanHistoryRow = {
    id: string;
    ticket_number: string;
    principal_amount: number;
    status: string;
    loan_date: string;
    maturity_date: string;
    extension_count: number;
    loan_payments: { id: string; amount: number; receipt_number: string; created_at: string }[];
    loan_extensions: { id: string; new_maturity_date: string; additional_interest_amount: number; created_at: string }[];
  };
  const loanHistory = (loans ?? []) as unknown as LoanHistoryRow[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{customer.full_name}</h1>
        {customer.is_blacklisted && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            ⚠ This customer is blacklisted{customer.blacklist_reason ? `: ${customer.blacklist_reason}` : ""}.
            New loans/appraisals should not proceed for this customer.
          </p>
        )}
        {customer.aml_status === "flagged" && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            AML check flagged this customer: {customer.aml_notes}
          </p>
        )}
      </div>

      <section>
        <h2 className="text-sm font-medium text-slate-900">Profile</h2>
        <div className="mt-2">
          <CustomerForm action={updateCustomer} customer={customer} />
        </div>
      </section>

      {user.profile.role === "admin" && (
        <section>
          <h2 className="text-sm font-medium text-slate-900">Blacklist status (Admin)</h2>
          <BlacklistForm customer={customer} />
        </section>
      )}

      <section>
        <h2 className="text-sm font-medium text-slate-900">Transaction history</h2>
        {loanHistory.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            No transactions yet — loans, payments, extensions and redemptions will appear
            here once a loan is created for this customer.
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {loanHistory.map((loan) => (
              <div key={loan.id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">
                    Ticket {loan.ticket_number} — ₱{Number(loan.principal_amount).toLocaleString()}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-700">
                    {loan.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Issued {loan.loan_date} · Matures {loan.maturity_date}
                  {loan.extension_count > 0 ? ` · Extended ${loan.extension_count}x` : ""}
                </p>
                {loan.loan_payments.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {loan.loan_payments.map((p) => (
                      <li key={p.id}>
                        Payment — receipt {p.receipt_number}: ₱{Number(p.amount).toLocaleString()} on{" "}
                        {new Date(p.created_at).toLocaleDateString()}
                      </li>
                    ))}
                  </ul>
                )}
                {loan.loan_extensions.length > 0 && (
                  <ul className="mt-1 space-y-1 text-xs text-slate-600">
                    {loan.loan_extensions.map((ext) => (
                      <li key={ext.id}>
                        Extended to {ext.new_maturity_date} — additional interest ₱
                        {Number(ext.additional_interest_amount).toLocaleString()} on{" "}
                        {new Date(ext.created_at).toLocaleDateString()}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
