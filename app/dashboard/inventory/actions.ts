"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { countDiscrepancies } from "@/lib/inventory/audit";

export type ActionState = { error?: string; success?: boolean; id?: string };

// PB-25: submit a physical inventory audit — one line per item checked.
export async function submitAudit(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["operator", "admin"]);

  const itemIds = formData.getAll("item_id").map(String);
  const expectedStatuses = formData.getAll("expected_status").map(String);
  const notes = String(formData.get("notes") ?? "");

  if (itemIds.length === 0) return { error: "No inventory items to audit" };

  const supabase = await createClient();
  const rows = itemIds.map((itemId, i) => ({
    inventory_item_id: itemId,
    expected_status: expectedStatuses[i] as never,
    found: formData.get(`found_${itemId}`) === "on",
    notes: String(formData.get(`notes_${itemId}`) ?? "") || null,
  }));
  const discrepancyCount = countDiscrepancies(rows);

  const { data: audit, error } = await supabase
    .from("physical_inventory_audits")
    .insert({ performed_by: user.id, notes: notes || null, discrepancy_count: discrepancyCount })
    .select("id")
    .single();
  if (error || !audit) return { error: error?.message ?? "Could not create audit" };

  const { error: itemsError } = await supabase
    .from("physical_inventory_audit_items")
    .insert(rows.map((r) => ({ ...r, audit_id: audit.id })));
  if (itemsError) return { error: itemsError.message };

  revalidatePath("/dashboard/inventory/audit");
  return { success: true, id: audit.id };
}

// PB-26: batch forfeited items together for the next auction cycle.
export async function createAuctionBatch(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["operator", "admin"]);
  const itemIds = formData.getAll("item_id").map(String);
  const notes = String(formData.get("notes") ?? "");
  if (itemIds.length === 0) return { error: "Select at least one forfeited item" };

  const supabase = await createClient();
  const { data: batch, error } = await supabase
    .from("auction_batches")
    .insert({ created_by: user.id, notes: notes || null })
    .select("id")
    .single();
  if (error || !batch) return { error: error?.message ?? "Could not create batch" };

  const { error: itemsError } = await supabase
    .from("auction_batch_items")
    .insert(itemIds.map((id) => ({ batch_id: batch.id, inventory_item_id: id })));
  if (itemsError) return { error: itemsError.message };

  await supabase.from("inventory_items").update({ status: "queued_for_auction" }).in("id", itemIds);

  revalidatePath("/dashboard/inventory/auction");
  return { success: true, id: batch.id };
}
