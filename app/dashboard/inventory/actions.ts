"use server";

import type { FieldErrors } from "@/lib/validation/errors";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";

export type ActionState = { error?: string; fieldErrors?: FieldErrors; success?: boolean; id?: string };

// PB-25: submit a physical inventory audit — one line per item checked.
export async function submitAudit(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["operator", "admin"]);

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

// PB-26: batch forfeited items together for the next auction cycle.
export async function createAuctionBatch(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["operator", "admin"]);
  const itemIds = formData.getAll("item_id").map(String);
  const notes = String(formData.get("notes") ?? "");
  if (itemIds.length === 0) return { error: "Select at least one forfeited item" };

  // One database call: only items an Admin has forfeited are accepted, and the batch,
  // its items and the status change are saved together, or not at all.
  const supabase = await createClient();
  const { data: batchId, error } = await supabase.rpc("create_auction_batch", { p_item_ids: itemIds, p_notes: notes });
  if (error || !batchId) return { error: error?.message ?? "Could not create the batch" };

  revalidatePath("/dashboard/inventory/auction");
  revalidatePath("/dashboard/inventory");
  return { success: true, id: batchId };
}
