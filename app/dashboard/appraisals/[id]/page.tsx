import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { ResolveForm } from "./resolve-form";

export default async function AppraisalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole(["appraiser", "cashier", "operator", "admin"]);
  const { id } = await params;

  const supabase = await createClient();
  const { data: appraisal } = await supabase
    .from("appraisal_items")
    .select("*, customers(full_name)")
    .eq("id", id)
    .single();
  if (!appraisal) notFound();

  const customerName = (appraisal as unknown as { customers: { full_name: string } | null })
    .customers?.full_name;

  const photoUrls = await Promise.all(
    appraisal.photo_paths.map(async (path) => {
      const { data } = await supabase.storage.from("item-photos").createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    }),
  );

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">
          {customerName} — {appraisal.weight_grams}g, {appraisal.karat}k
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Purity tested at {appraisal.purity_percent}%. {appraisal.condition_notes}
        </p>
      </div>

      {appraisal.is_counterfeit_risk && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            ⚠ Counterfeit risk flagged — purity is outside the expected range for a claimed{" "}
            {appraisal.karat}k item.
          </p>
          <p className="mt-1 text-sm text-red-700">
            Resolution: {appraisal.counterfeit_resolution}
          </p>
          {user.profile.role === "admin" && appraisal.counterfeit_resolution === "pending" && (
            <ResolveForm appraisalId={appraisal.id} />
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 rounded-md border border-slate-200 bg-white p-4 text-sm">
        <div>
          <div className="text-slate-500">Computed value</div>
          <div className="text-lg font-semibold text-slate-900">
            ₱{appraisal.computed_value.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Suggested loan range</div>
          <div className="text-lg font-semibold text-slate-900">
            ₱{appraisal.suggested_loan_min.toLocaleString()} – ₱
            {appraisal.suggested_loan_max.toLocaleString()}
          </div>
        </div>
        <div className="col-span-2 text-xs text-slate-400">
          Gold price used: ₱{appraisal.gold_price_used}/g · LTV used: {appraisal.ltv_percent_used}%
        </div>
      </div>

      {photoUrls.filter(Boolean).length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-slate-900">Photos</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {photoUrls.filter(Boolean).map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url!} alt="Item" className="h-32 w-32 rounded-md object-cover" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
