import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { computeCustomerScore, weightsFromRows, type CustomerScore, type ScoreLoan } from "./score";

/** Loads every loan (archived ones included, on purpose) and scores each customer. */
export async function loadCustomerScores(
  supabase: SupabaseClient<Database>,
  customerIds: string[],
  today: string,
): Promise<Map<string, CustomerScore>> {
  const result = new Map<string, CustomerScore>();
  if (customerIds.length === 0) return result;
  const [{ data: loans }, { data: weightRows }] = await Promise.all([
    supabase
      .from("loans")
      .select("customer_id, status, loan_date, maturity_date, extension_count, late_payment_count, defaulted_at, reinstated_at, redeemed_at, principal_balance, interest_owed, interest_rate_percent, interest_accrued_through, grace_period_days, liquidated_damages_percent, damages_owed, damages_accrued_through") // F3: balances too, so a paid loan isn't counted as overdue
      .in("customer_id", customerIds),
    supabase.from("score_weights").select("key, value"),
  ]);
  const weights = weightsFromRows(weightRows);
  const byCustomer = new Map<string, ScoreLoan[]>();
  for (const loan of loans ?? []) {
    const list = byCustomer.get(loan.customer_id) ?? [];
    list.push(loan);
    byCustomer.set(loan.customer_id, list);
  }
  for (const id of customerIds) result.set(id, computeCustomerScore(byCustomer.get(id) ?? [], today, weights));
  return result;
}
