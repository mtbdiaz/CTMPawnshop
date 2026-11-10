import { appraisalNo, customerNo } from "@/lib/ref-numbers"; // #29: the item's short number in the picker; #38: C-0012
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { isPawnable } from "@/lib/appraisal/pool";
import { formatDateTime, manilaToday } from "@/lib/format";
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
  const [{ data: items }, { data: settings }, { data: vaultRows }] = await Promise.all([
    supabase
      .from("appraisal_items")
      .select("id, appraisal_no, status, archived_at, category, category_other, karat, weight_grams, computed_value, suggested_loan_max, is_counterfeit_risk, counterfeit_resolution, created_at, appraised_by, customer_id, customers(full_name, customer_no)") // #38: + who the item was appraised for
      .eq("status", "available")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("system_settings").select("price_24k, price_21k, price_18k, ltv_percent, interest_rate_percent").eq("id", 1).maybeSingle(),
    supabase.from("vault_locations").select("name").eq("is_active", true).order("name"), // #37: the locations a new loan may use
  ]);
  const vaults = (vaultRows ?? []).map((v) => v.name);

  // NL8: who appraised each item, so two similar items ("Ring, 18K") can be told apart
  const pawnable = (items ?? []).filter(isPawnable);
  const staffIds = [...new Set(pawnable.map((a) => a.appraised_by).filter((x): x is string => Boolean(x)))];
  const { data: staff } = staffIds.length ? await supabase.from("profiles").select("id, full_name").in("id", staffIds) : { data: [] };
  const staffName = new Map((staff ?? []).map((p) => [p.id, p.full_name]));

  const pool: PoolItem[] = pawnable
    .map((a) => ({
      id: a.id,
      // #29: the A-number at the end, so staff can match the item to its tag ("Ring, 18K, 2 g · A-0045")
      label: `${categoryLabel(a.category, a.category_other)}, ${a.karat}K, ${a.weight_grams} g · ${appraisalNo(a.appraisal_no)}`,
      value: Number(a.computed_value),
      max: Number(a.suggested_loan_max),
      // NL8: "Appraised Nov 5, 2026, 3:10 PM by Ana Cruz"
      meta: `Appraised ${formatDateTime(a.created_at)}${a.appraised_by && staffName.get(a.appraised_by) ? ` by ${staffName.get(a.appraised_by)}` : ""}`,
      // #38: the customer the item was appraised for (null on older appraisals: anyone can pawn those)
      customerId: a.customer_id,
      owner: a.customers ? `${a.customers.full_name} (${customerNo(a.customers.customer_no)})` : null,
    }));
  // #38: opened from an appraisal ("Create loan") with no customer in the link: start with the item's own customer
  const itemOwnerId = !params.customer && params.item ? (pool.find((p) => p.id === params.item)?.customerId ?? null) : null;
  const initialCustomer = params.customer ? await loadCustomer(supabase, params.customer) : itemOwnerId ? await loadCustomer(supabase, itemOwnerId) : null;

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
          vaults={vaults}
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
