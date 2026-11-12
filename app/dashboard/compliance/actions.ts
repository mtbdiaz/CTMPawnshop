"use server";

import type { FieldErrors } from "@/lib/validation/errors";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { allowRequest, TOO_MANY } from "@/lib/rate-limit"; // #22: rate limiting
// R3: the allowed contact methods and results (same lists as the database enums)
import { isMethod, isOutcome, type ReminderMethod, type ReminderOutcome } from "@/lib/compliance/reminder-outcomes";
import { cleanNote, reasonProblem } from "@/lib/compliance/flags"; // SA7: the reason rule (same as the database)

export type ActionState = { error?: string; fieldErrors?: FieldErrors; success?: boolean };

// PB-32 + SA6 (migration 0060): an Admin decides a suspicious activity flag.
// Before: two separate saves from here (blacklist the customer, then update the flag), and nothing checked that the
// flag was still open, so a second Admin on an older screen could overwrite a decision.
// Now: one database function (review_suspicious_flag) checks the role and the step, refuses a flag that was already
// decided (and says who decided it), and blacklists the customer and closes the flag together or not at all.
export async function resolveSuspiciousFlag(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
  const flagId = String(formData.get("flag_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(flagId) || !["dismissed", "investigating", "blacklisted"].includes(decision)) {
    return { error: "Invalid decision. Reload the page and try again." };
  }
  // SA7 (migration 0062): the status the popup showed. If another Admin changed the flag since, the database refuses
  // and says what it is now, so nobody decides on something they haven't seen.
  const expected = String(formData.get("expected_status") ?? "");
  if (!["open", "investigating"].includes(expected)) return { error: "Reload the page and try again." };
  // the note: optional for Mark investigating, a real reason for Dismiss and Blacklist (SAD UC25, same rule as the
  // database). Extra spaces are squeezed out.
  const notes = cleanNote(String(formData.get("resolution_notes") ?? ""));
  const problem = decision === "investigating" ? (notes.length > 500 ? "Keep the note to 500 characters or less." : null) : reasonProblem(notes);
  if (problem) return { fieldErrors: { resolution_notes: problem } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_suspicious_flag", {
    p_flag: flagId,
    p_decision: decision,
    p_notes: notes || undefined,
    p_expected_status: expected,
  });
  if (error) return { error: error.message }; // plain messages from the database ("This flag was already decided: ...")

  revalidatePath("/dashboard/compliance");
  revalidatePath("/dashboard/customers", "layout"); // the customer list and profile show the blacklist
  revalidatePath("/dashboard"); // the Dashboard's open-flag count
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
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
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
