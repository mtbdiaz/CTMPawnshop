"use server";

import type { FieldErrors } from "@/lib/validation/errors";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
// R3: the allowed contact methods and results (same lists as the database enums)
import { isMethod, isOutcome, type ReminderMethod, type ReminderOutcome } from "@/lib/compliance/reminder-outcomes";

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

// PB-33 + R1 + R3: "Log contact" on the Reminders page. It only RECORDS that staff called, texted or talked to the
// customer, how, and what happened. PawnTrack has no SMS/email service, so nothing is sent from here (see DECISIONS_LOG.md).
// Since migration 0027 the database function log_reminder does every check (role, loan still open and due within
// 3 days, double clicks) and saves the log, so a direct insert isn't needed any more.
export async function logContact(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["cashier", "admin"]); // Cashier or Admin (the database checks again)
  const loanId = String(formData.get("loan_id") ?? "");
  const method = String(formData.get("contact_method") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  // a loan id is a UUID; anything else is a broken or edited form
  if (!/^[0-9a-f-]{36}$/i.test(loanId)) return { error: "Missing loan. Reload the page and try again." };

  // R3: the two choices are required, the note is optional (500 characters at most, same as the database)
  const fieldErrors: FieldErrors = {};
  if (!isMethod(method)) fieldErrors.contact_method = "Pick how you contacted the customer.";
  if (!isOutcome(outcome)) fieldErrors.outcome = "Pick what happened.";
  if (notes.length > 500) fieldErrors.notes = "Keep the note to 500 characters or less.";
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase.rpc("log_reminder", {
    p_loan_id: loanId,
    p_method: method as ReminderMethod,
    p_outcome: outcome as ReminderOutcome,
    p_notes: notes, // an empty note is saved as no note
  });
  if (error) return { error: error.message }; // the database's message is already plain (e.g. "isn't due within 3 days any more")

  revalidatePath("/dashboard/compliance/reminders"); // the list shows the new status
  revalidatePath("/dashboard"); // the Dashboard's reminder count
  return { success: true };
}
