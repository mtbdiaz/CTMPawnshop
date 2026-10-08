"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { rankCustomers } from "@/lib/customers/search";
import { loadCustomerScores } from "@/lib/customers/history";
import type { CustomerScore } from "@/lib/customers/score";
import { manilaToday } from "@/lib/format";

export type CustomerHit = {
  id: string;
  full_name: string;
  contact_number: string;
  id_type: string;
  id_number: string;
  is_blacklisted: boolean;
  blacklist_reason: string | null;
  aml_status: string;
  history: CustomerScore;
};

// Item 10: search-as-you-type. The database narrows candidates with a
// case-insensitive match on name, phone or ID; ranking (prefix first) and
// scoring happen here so the order is consistent with the unit-tested rules.
export async function searchCustomers(query: string): Promise<CustomerHit[]> {
  await requireRole(["cashier", "admin"]);
  const q = query.trim();
  if (!q) return [];
  const safe = q.replace(/[%,()*\\]/g, " ").slice(0, 60);
  const compact = safe.replace(/[\s-]/g, "");

  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, full_name, contact_number, id_type, id_number, is_blacklisted, blacklist_reason, aml_status")
    .is("archived_at", null)
    .or(
      [`full_name.ilike.%${safe}%`, `contact_number.ilike.%${safe}%`, `id_number.ilike.%${safe}%`]
        .concat(compact && compact !== safe ? [`contact_number.ilike.%${compact}%`, `id_number.ilike.%${compact}%`] : [])
        .join(","),
    )
    .limit(60);

  const ranked = rankCustomers(data ?? [], q, 8);
  const scores = await loadCustomerScores(supabase, ranked.map((c) => c.id), manilaToday());
  return ranked.map((c) => ({ ...c, history: scores.get(c.id)! }));
}
