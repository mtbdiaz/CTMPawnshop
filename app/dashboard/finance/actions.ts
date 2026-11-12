"use server";

import { validationFailure, type FieldErrors } from "@/lib/validation/errors";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { allowRequest, TOO_MANY } from "@/lib/rate-limit"; // #22: rate limiting
import { cashEntrySchema } from "@/lib/validation/cashflow";

export type ActionState = { error?: string; fieldErrors?: FieldErrors; success?: boolean };

// PB-29 + CL1 (migration 0055): record a manual Expense or Revenue (money not tied to a loan).
// Before: the row was inserted straight into the ledger table, with no protection against being saved twice.
// Now: one database function (record_cash_entry) checks the role, the type, the amount and the description again,
// and a one-time request id makes the same Save sent twice (a retry, a second click) one entry.
export async function recordCashEntry(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["operator", "cashier", "admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
  const parsed = cashEntrySchema.safeParse({
    entry_type: formData.get("entry_type"),
    amount: String(formData.get("amount") ?? ""),
    description: formData.get("description"),
  });
  if (!parsed.success) return validationFailure(parsed.error);
  const requestId = String(formData.get("request_id") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_cash_entry", {
    p_type: parsed.data.entry_type,
    p_amount: parsed.data.amount,
    p_description: parsed.data.description,
    p_request_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId) ? requestId : undefined,
  });
  if (error) return { error: error.message }; // the database's messages are plain ("Amount must be greater than 0")

  revalidatePath("/dashboard/finance");
  revalidatePath("/dashboard"); // today's cash on the Dashboard
  return { success: true };
}

// Item 5: Admin correction of a manual entry. Reason required; audited.
export async function adminEditCashEntry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
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
