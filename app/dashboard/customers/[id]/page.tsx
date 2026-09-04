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
        <p className="mt-2 text-sm text-slate-500">
          No transactions yet — loans, payments, extensions and redemptions will appear here
          once Loan &amp; Transaction Management (Sprints 4-5) is built.
        </p>
      </section>
    </div>
  );
}
