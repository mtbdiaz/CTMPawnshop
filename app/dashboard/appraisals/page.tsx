import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { NewAppraisalForm } from "./new-appraisal-form";

export default async function AppraisalsPage() {
  await requireRole(["appraiser", "cashier", "operator", "admin"]);

  const supabase = await createClient();
  const [{ data: appraisals }, { data: customers }] = await Promise.all([
    supabase
      .from("appraisal_items")
      .select("*, customers(full_name)")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("customers").select("id, full_name").order("full_name"),
  ]);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Appraisal &amp; Valuation</h1>
      <p className="mt-1 text-sm text-slate-500">
        Record item details, capture photos, and get an automatic valuation and suggested loan
        range from the current gold price.
      </p>

      <details className="mt-6 rounded-md border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium text-slate-900">
          New appraisal
        </summary>
        <div className="mt-4">
          <NewAppraisalForm customers={customers ?? []} />
        </div>
      </details>

      <table className="mt-6 w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500">
            <th className="pb-2 pr-4">Customer</th>
            <th className="pb-2 pr-4">Item</th>
            <th className="pb-2 pr-4">Value</th>
            <th className="pb-2 pr-4">Suggested loan</th>
            <th className="pb-2 pr-4">Risk</th>
          </tr>
        </thead>
        <tbody>
          {appraisals?.length ? (
            appraisals.map((a) => (
              <tr key={a.id} className="border-t border-slate-200">
                <td className="py-2 pr-4">
                  {(a as unknown as { customers: { full_name: string } | null }).customers
                    ?.full_name ?? "—"}
                </td>
                <td className="py-2 pr-4">
                  <Link href={`/dashboard/appraisals/${a.id}`} className="hover:underline">
                    {a.weight_grams}g, {a.karat}k
                  </Link>
                </td>
                <td className="py-2 pr-4">₱{a.computed_value.toLocaleString()}</td>
                <td className="py-2 pr-4">
                  ₱{a.suggested_loan_min.toLocaleString()} – ₱{a.suggested_loan_max.toLocaleString()}
                </td>
                <td className="py-2 pr-4">
                  {a.is_counterfeit_risk ? (
                    <span
                      className={
                        a.counterfeit_resolution === "pending"
                          ? "rounded bg-red-100 px-2 py-0.5 text-xs text-red-800"
                          : "rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                      }
                    >
                      {a.counterfeit_resolution}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="py-4 text-sm text-slate-500">
                No appraisals yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
