"use server";

import { validationFailure, type FieldErrors } from "@/lib/validation/errors";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { cashEntrySchema } from "@/lib/validation/cashflow";

export type ActionState = { error?: string; fieldErrors?: FieldErrors; success?: boolean };

// PB-29: Operator records non-loan operating expenses/revenue.
export async function recordCashEntry(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["operator", "cashier", "admin"]);
  const parsed = cashEntrySchema.safeParse({
    entry_type: formData.get("entry_type"),
    amount: formData.get("amount"),
    description: formData.get("description"),
  });
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("cash_flow_entries").insert({
    entry_type: parsed.data.entry_type,
    direction: parsed.data.entry_type === "revenue" ? "in" : "out",
    amount: parsed.data.amount,
    description: parsed.data.description,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/finance");
  return { success: true };
}

// Item 5: Admin correction of a manual entry. Reason required; audited.
export async function adminEditCashEntry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["admin"]);
  const id = String(formData.get("entry_id") ?? "");
  const amount = Number(formData.get("amount"));
  const description = String(formData.get("description") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const fieldErrors: FieldErrors = {};
  if (!(amount > 0)) fieldErrors.amount = "Amount must be greater than 0";
  if (!description) fieldErrors.description = "Description is required";
  if (reason.length < 5) fieldErrors.reason = "Write a reason of at least 5 characters";
  if (!id || Object.keys(fieldErrors).length) return { error: "Please fix the highlighted fields.", fieldErrors };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_edit_cash_entry", { p_id: id, p_amount: amount, p_description: description, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath("/dashboard/finance");
  return { success: true };
}
