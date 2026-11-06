"use server";

import type { FieldErrors } from "@/lib/validation/errors";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";

export type ActionState = { error?: string; fieldErrors?: FieldErrors; success?: boolean };

// PB-32: Admin reviews a suspicious activity flag.
export async function resolveSuspiciousFlag(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["admin"]);
  const flagId = String(formData.get("flag_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!flagId || !["dismissed", "investigating", "blacklisted"].includes(decision)) {
    return { error: "Invalid decision" };
  }

  const supabase = await createClient();
  // Blacklist first: if that fails, the flag stays as it was and the Admin sees the error.
  if (decision === "blacklisted") {
    const { data: target, error: readError } = await supabase.from("suspicious_activity_flags").select("customer_id").eq("id", flagId).single();
    if (readError) return { error: readError.message };
    if (target?.customer_id) {
      const { error: blError } = await supabase
        .from("customers")
        .update({ is_blacklisted: true, blacklist_reason: "Blacklisted following suspicious activity review" })
        .eq("id", target.customer_id);
      if (blError) return { error: `Could not blacklist the customer: ${blError.message}` };
    }
  }

  const { error } = await supabase
    .from("suspicious_activity_flags")
    .update({ status: decision as never, resolved_by: user.id, resolved_at: new Date().toISOString() })
    .eq("id", flagId);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/customers");

  revalidatePath("/dashboard/compliance");
  return { success: true };
}

// PB-33: log a due-date reminder as sent (no email/SMS provider configured
// in this environment — see DECISIONS_LOG.md).
export async function sendReminder(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["cashier", "admin"]);
  const loanId = String(formData.get("loan_id") ?? "");
  if (!loanId) return { error: "Missing loan id" };

  const supabase = await createClient();
  const { error } = await supabase.from("reminder_log").insert({ loan_id: loanId, created_by: user.id });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/compliance/reminders");
  return { success: true };
}
