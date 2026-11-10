"use server";

import type { FieldErrors } from "@/lib/validation/errors";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { allowRequest, TOO_MANY } from "@/lib/rate-limit"; // #22: rate limiting

export type ActionState = { error?: string; fieldErrors?: FieldErrors; success?: boolean; id?: string };

// PB-25: submit a physical inventory audit — one line per item checked.
export async function submitAudit(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["operator", "admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account

  const itemIds = formData.getAll("item_id").map(String);
  const expectedStatuses = formData.getAll("expected_status").map(String);
  const notes = String(formData.get("notes") ?? "");

  if (itemIds.length === 0) return { error: "No inventory items to audit" };

  const rows = itemIds.map((itemId, i) => ({
    inventory_item_id: itemId,
    expected_status: expectedStatuses[i],
    found: formData.get(`found_${itemId}`) === "on",
    notes: String(formData.get(`notes_${itemId}`) ?? "") || null,
  }));

  // One database call: the audit and every line are saved together, or not at all.
  const supabase = await createClient();
  const { data: auditId, error } = await supabase.rpc("submit_inventory_audit", { p_items: rows, p_notes: notes });
  if (error || !auditId) return { error: error?.message ?? "Could not save the audit" };

  revalidatePath("/dashboard/inventory/audit");
  return { success: true, id: auditId };
}

// PB-26 + UC18: batch forfeited items together for the next auction cycle, each with an optional minimum price.
export async function createAuctionBatch(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["operator", "admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
  const itemIds = formData.getAll("item_id").map(String);
  const notes = String(formData.get("notes") ?? "");
  if (itemIds.length === 0) return { error: "Select at least one forfeited item" };

  // UC18 step 2: the minimum price box next to each ticked item (empty = no minimum)
  const fieldErrors: FieldErrors = {};
  const minPrices = itemIds.map((id) => {
    const raw = String(formData.get(`min_price_${id}`) ?? "").replace(/,/g, "").trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n > 10_000_000 || !/^\d+(\.\d{1,2})?$/.test(raw)) {
      fieldErrors[`min_price_${id}`] = "Enter an amount in pesos, like 5000 or 5000.50.";
      return null;
    }
    return n;
  });
  if (Object.keys(fieldErrors).length) return { error: "Check the minimum prices: use pesos only, like 5000 or 5000.50.", fieldErrors };

  // One database call: only items an Admin has forfeited are accepted, and the batch, its items (with their
  // minimum prices) and the status change are saved together, or not at all.
  const supabase = await createClient();
  const { data: batchId, error } = await supabase.rpc("create_auction_batch", {
    p_item_ids: itemIds,
    p_notes: notes,
    // only send the prices when at least one was typed (the database then checks each one)
    p_min_prices: minPrices.some((n) => n !== null) ? (minPrices as number[]) : undefined,
  });
  if (error || !batchId) return { error: error?.message ?? "Could not create the batch" };

  revalidatePath("/dashboard/inventory/auction");
  revalidatePath("/dashboard/inventory");
  return { success: true, id: batchId };
}

// #43 + UC16: record that a queued item was sold. The database (record_auction_sale, migration 0031) checks the
// role, that the item is queued in an open batch and that the price is not below its minimum, then marks it
// Sold and adds the money to the cash ledger, all together.
export async function recordSale(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["operator", "admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
  const itemId = String(formData.get("item_id") ?? "");
  const raw = String(formData.get("sale_price") ?? "").replace(/,/g, "").trim();
  const buyer = String(formData.get("buyer_name") ?? "").trim();
  const notes = String(formData.get("sale_notes") ?? "").trim();
  const requestId = String(formData.get("request_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return { error: "Missing item. Reload the page and try again." };

  const fieldErrors: FieldErrors = {};
  const price = Number(raw);
  if (!raw || !Number.isFinite(price) || price <= 0 || price > 10_000_000 || !/^\d+(\.\d{1,2})?$/.test(raw))
    fieldErrors.sale_price = "Enter the sale price in pesos, like 15000 or 15000.50.";
  if (buyer.length > 120) fieldErrors.buyer_name = "Keep the buyer name to 120 characters or less.";
  if (notes.length > 500) fieldErrors.sale_notes = "Keep the note to 500 characters or less.";
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_auction_sale", {
    p_item_id: itemId,
    p_sale_price: price,
    p_buyer: buyer || undefined,
    p_notes: notes || undefined,
    p_request_id: /^[0-9a-f-]{36}$/i.test(requestId) ? requestId : undefined, // the same form sent twice = one sale
  });
  if (error) return { error: error.message }; // the database's messages are plain ("below this item's minimum price (₱5,000.00)")

  revalidatePath("/dashboard/inventory/auction");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/finance"); // the sale shows in the cash ledger
  return { success: true };
}

// #14: an item marked missing in a physical audit was found later. The database (resolve_audit_item, migration 0033)
// checks the role (Operator or Admin), that the line was really marked missing and isn't resolved yet, and saves who,
// when and the note. The audit itself is never changed, so the record of what was missing that day stays.
export async function markAuditItemFound(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["operator", "admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
  const lineId = String(formData.get("line_id") ?? "");
  const notes = String(formData.get("resolution_notes") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(lineId)) return { error: "Missing audit line. Reload the page and try again." };
  if (notes.length < 5) return { fieldErrors: { resolution_notes: "Write where it was found (at least 5 characters)." } };
  if (notes.length > 500) return { fieldErrors: { resolution_notes: "Keep the note to 500 characters or less." } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_audit_item", { p_line_id: lineId, p_notes: notes });
  if (error) return { error: error.message }; // plain words from the database, e.g. "already marked found"

  revalidatePath("/dashboard/inventory/audit");
  return { success: true };
}
