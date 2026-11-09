"use server";

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { rankCustomers } from "@/lib/customers/search";
import { loadCustomerScores } from "@/lib/customers/history";
import type { CustomerScore } from "@/lib/customers/score";
import { manilaToday } from "@/lib/format";
import { maskId } from "@/lib/customers/id-privacy"; // #19: only the last 4 of an ID number reach the browser

export type CustomerHit = {
  id: string;
  full_name: string;
  contact_number: string;
  id_type: string;
  id_number: string; // #19: MASKED ("•••• 0418"). The full number never leaves the server on this page
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
  const { data } = await createAdminClient() // #17: id_number is not readable with a staff login; the server reads it after requireRole
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
  // #19: search by the full ID still works (above, on the server), but the browser only gets the last 4
  return ranked.map((c) => ({ ...c, id_number: maskId(c.id_number), history: scores.get(c.id)! }));
}
