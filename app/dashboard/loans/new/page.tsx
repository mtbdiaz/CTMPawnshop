import { appraisalNo } from "@/lib/ref-numbers"; // #29: the item's short number in the picker
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { isPawnable } from "@/lib/appraisal/pool";
import { manilaToday } from "@/lib/format";
import { loadCustomerScores } from "@/lib/customers/history";
import { maskId } from "@/lib/customers/id-privacy"; // #19 only the last 4 reach the browser
import { PageHeader } from "@/components/ui";
import type { CustomerHit } from "./actions";
import { NewLoanFlow, type PoolItem } from "./new-loan-flow";

export const metadata = { title: "New loan" };

// Item 10: customer, item, terms, review. Items come from the available pool.
export default async function NewLoanPage({ searchParams }: { searchParams: Promise<{ customer?: string; item?: string }> }) {
  await requireRole(["cashier", "admin"]);
  const params = await searchParams;
  const supabase = await createClient();
  const initialCustomer = params.customer ? await loadCustomer(supabase, params.customer) : null;
  const [{ data: items }, { data: settings }] = await Promise.all([
    supabase
      .from("appraisal_items")
      .select("id, appraisal_no, status, archived_at, category, category_other, karat, weight_grams, computed_value, suggested_loan_max, is_counterfeit_risk, counterfeit_resolution, created_at")
      .eq("status", "available")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("system_settings").select("price_24k, price_21k, price_18k, ltv_percent, interest_rate_percent").eq("id", 1).maybeSingle(),
  ]);

  const pool: PoolItem[] = (items ?? [])
    .filter(isPawnable)
    .map((a) => ({
      id: a.id,
      // #29: the A-number at the end, so staff can match the item to its tag ("Ring, 18K, 2 g · A-0045")
      label: `${categoryLabel(a.category, a.category_other)}, ${a.karat}K, ${a.weight_grams} g · ${appraisalNo(a.appraisal_no)}`,
      value: Number(a.computed_value),
      max: Number(a.suggested_loan_max),
    }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="New loan"
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Loans", href: "/dashboard/loans" }, { label: "New loan" }]}
      />
      {settings ? (
        <NewLoanFlow
          pool={pool}
          prices={settings}
          ltvPercent={Number(settings.ltv_percent)}
          interestRatePercent={Number(settings.interest_rate_percent)}
          initialCustomer={initialCustomer}
          initialItemId={params.item}
        />
      ) : (
        <p className="text-sm text-red-700">Rates are not configured. An Admin must set them in Settings first.</p>
      )}
    </div>
  );
}

async function loadCustomer(supabase: Awaited<ReturnType<typeof createClient>>, id: string): Promise<CustomerHit | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await createAdminClient() // #17: id_number is not readable with a staff login; the server reads it after requireRole
    .from("customers")
    .select("id, customer_no, full_name, contact_number, id_type, id_number, is_blacklisted, blacklist_reason, aml_status")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (!data) return null;
  const scores = await loadCustomerScores(supabase, [data.id], manilaToday());
  return { ...data, id_number: maskId(data.id_number), history: scores.get(data.id)! }; // #19 masked, same as the search
}
