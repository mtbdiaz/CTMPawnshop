import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createCustomer } from "./actions";
import { CustomerForm } from "./customer-form";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireRole(["operator", "cashier", "appraiser", "admin"]);
  const { q } = await searchParams;

  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (q) query = query.ilike("full_name", `%${q}%`);
  const { data: customers } = await query;

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Customer Management</h1>
      <p className="mt-1 text-sm text-slate-500">
        Register new customers and manage existing profiles.
      </p>

      <details className="mt-6 rounded-md border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium text-slate-900">
          Register new customer
        </summary>
        <div className="mt-4">
          <CustomerForm action={createCustomer} />
        </div>
      </details>

      <form className="mt-6" action="/dashboard/customers">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name..."
          className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </form>

      <table className="mt-4 w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500">
            <th className="pb-2 pr-4">Name</th>
            <th className="pb-2 pr-4">Contact</th>
            <th className="pb-2 pr-4">AML</th>
            <th className="pb-2 pr-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {customers?.length ? (
            customers.map((c) => (
              <tr key={c.id} className="border-t border-slate-200">
                <td className="py-2 pr-4">
                  <Link href={`/dashboard/customers/${c.id}`} className="text-slate-900 hover:underline">
                    {c.full_name}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-slate-600">{c.contact_number}</td>
                <td className="py-2 pr-4">
                  <span
                    className={
                      c.aml_status === "flagged"
                        ? "rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
                        : "rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                    }
                  >
                    {c.aml_status}
                  </span>
                </td>
                <td className="py-2 pr-4">
                  {c.is_blacklisted && (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">
                      Blacklisted
                    </span>
                  )}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4} className="py-4 text-sm text-slate-500">
                No customers yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
