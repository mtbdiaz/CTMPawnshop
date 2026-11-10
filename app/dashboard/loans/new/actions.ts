"use server";

import { parseRefNo } from "@/lib/ref-numbers"; // #18: "C-0012" finds that customer
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { allowRequest } from "@/lib/rate-limit"; // #22: rate limiting
import { rankCustomers } from "@/lib/customers/search";
import { loadCustomerScores } from "@/lib/customers/history";
import type { CustomerScore } from "@/lib/customers/score";
import { manilaToday } from "@/lib/format";
import { maskId } from "@/lib/customers/id-privacy"; // #19: only the last 4 of an ID number reach the browser

export type CustomerHit = {
  id: string;
  customer_no: number; // #18: shown as C-0012
  full_name: string;
  contact_number: string;
  id_type: string;
  id_number: string; // #19: MASKED ("•••• 0418"). The full number never leaves the server on this page
  is_blacklisted: boolean;
  blacklist_reason: string | null;
  aml_status: string;
  history: CustomerScore;
  similar?: boolean; // #16: true = found by a close name (a typo), not an exact match
};

// Item 10: search-as-you-type. The database narrows candidates with a
// case-insensitive match on name, phone or ID; ranking (prefix first) and
// scoring happen here so the order is consistent with the unit-tested rules.
// #22: over 60 searches a minute it answers { limited: true } instead of a list, and the form says so.
export async function searchCustomers(query: string): Promise<CustomerHit[] | { limited: true }> {
  await requireRole(["cashier", "admin"]);
  const q = query.trim();
  if (!q) return [];
  if (!(await allowRequest("search"))) return { limited: true }; // #22
  const safe = q.replace(/[%,()*\\]/g, " ").slice(0, 60);
  const compact = safe.replace(/[\s-]/g, "");

  const supabase = await createClient();
  const ref = parseRefNo(q); // #18: a typed customer number finds exactly that customer
  let find = createAdminClient() // #17: id_number is not readable with a staff login; the server reads it after requireRole
    .from("customers")
    .select("id, customer_no, full_name, contact_number, id_type, id_number, is_blacklisted, blacklist_reason, aml_status")
    .is("archived_at", null);
  find =
    ref?.kind === "C"
      ? find.eq("customer_no", ref.n)
      : find.or(
          [`full_name.ilike.%${safe}%`, `contact_number.ilike.%${safe}%`, `id_number.ilike.%${safe}%`]
            .concat(compact && compact !== safe ? [`contact_number.ilike.%${compact}%`, `id_number.ilike.%${compact}%`] : [])
            .join(","),
        );
  const { data } = await find.limit(60);

  // a C-number already found the exact customer; the ranking only matches name/phone/ID, so it would throw that row away
  let ranked = ref?.kind === "C" ? (data ?? []) : rankCustomers(data ?? [], q, 8);
  // #16: nobody found by a text search -> try names that are close to what was typed (a typo like "Bautsita")
  let similar = false;
  if (!ranked.length && ref?.kind !== "C" && /[a-z]/i.test(q)) {
    const { data: close } = await supabase.rpc("search_customers_fuzzy", { p_q: q, p_limit: 5 }); // best matches first
    const ids = (close ?? []).map((r) => r.id);
    if (ids.length) {
      const { data: rows } = await createAdminClient() // same columns as above
        .from("customers")
        .select("id, customer_no, full_name, contact_number, id_type, id_number, is_blacklisted, blacklist_reason, aml_status")
        .is("archived_at", null)
        .in("id", ids);
      const order = new Map(ids.map((id, i) => [id, i])); // keep the closest name on top
      ranked = (rows ?? []).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      similar = ranked.length > 0;
    }
  }
  const scores = await loadCustomerScores(supabase, ranked.map((c) => c.id), manilaToday());
  // #19: search by the full ID still works (above, on the server), but the browser only gets the last 4
  return ranked.map((c) => ({ ...c, id_number: maskId(c.id_number), history: scores.get(c.id)!, similar }));
}

// #39: what the Terms panel shows for an amount, worked out by the DATABASE (preview_pawn_loan, migration 0038)
// with the same math the loan itself gets, so the screen and the saved loan can't disagree.
export type LoanPreview = { maxLoan: number; ratePercent: number; interest: number; due: string; redeemOnTime: number };

// Returns null when there is nothing to show (bad input, over the search limit, or the database couldn't answer).
// The form then falls back to its own math, which follows the same rule.
export async function previewLoan(itemId: string, amount: number): Promise<LoanPreview | null> {
  await requireRole(["cashier", "admin"]);
  if (!/^[0-9a-f-]{36}$/i.test(itemId) || !Number.isFinite(amount) || amount <= 0) return null; // only real ids and amounts
  if (!(await allowRequest("search"))) return null; // #22: counted with the searches (it runs while the cashier types)
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_pawn_loan", { p_appraisal_item_id: itemId, p_principal_amount: amount });
  const row = data?.[0]; // one row for the item (none if the item doesn't exist)
  if (error || !row) return null;
  return {
    maxLoan: Number(row.max_loan),
    ratePercent: Number(row.interest_rate_percent),
    interest: Number(row.interest),
    due: row.maturity_date,
    redeemOnTime: Number(row.redeem_on_time),
  };
}
