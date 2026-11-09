"use server";

import type { FieldErrors } from "@/lib/validation/errors";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { isDueForReminder } from "@/lib/compliance/reminders"; // R1: due today up to 3 days from now
import { manilaToday } from "@/lib/format"; // R1: today's date in Manila

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

// PB-33 + R1: "Log contact" on the Reminders page. It only RECORDS that staff called, texted or talked to the
// customer. PawnTrack has no SMS/email service, so nothing is sent from here (see DECISIONS_LOG.md).
// The database also checks the role (reminder_log RLS: Cashier or Admin only).
const LOG_AGAIN_WAIT_MS = 2 * 60 * 1000; // a second log for the same loan within 2 minutes = a double click or a retry

export async function logContact(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["cashier", "admin"]); // the staff member who logs it
  const loanId = String(formData.get("loan_id") ?? "");
  // a loan id is a UUID; anything else is a broken or edited form
  if (!/^[0-9a-f-]{36}$/i.test(loanId)) return { error: "Missing loan. Reload the page and try again." };

  const supabase = await createClient();
  // check the loan AGAIN on the server: it may have been paid, renewed or closed since the page loaded
  const { data: loan, error: loanError } = await supabase
    .from("loans")
    .select("status, archived_at, maturity_date, principal_balance, interest_owed")
    .eq("id", loanId)
    .maybeSingle();
  if (loanError) return { error: loanError.message };
  if (!loan) return { error: "Loan not found. Reload the page." };
  if (!["active", "extended", "reinstated"].includes(loan.status) || loan.archived_at) {
    return { error: "This loan is no longer open (redeemed, defaulted or archived). Reload the page." };
  }
  if (Number(loan.principal_balance) <= 0 && Number(loan.interest_owed) <= 0) {
    return { error: "This loan is fully paid, so it doesn't need a payment reminder. Release the item with Redeem." };
  }
  if (!isDueForReminder(loan.maturity_date, manilaToday())) {
    return { error: "This loan isn't due within 3 days any more (its due date changed). Reload the page." };
  }

  // double click or network retry: a log for this loan in the last 2 minutes means it's already saved, so don't add another
  const since = new Date(Date.now() - LOG_AGAIN_WAIT_MS).toISOString();
  const { data: recent } = await supabase
    .from("reminder_log")
    .select("id")
    .eq("loan_id", loanId)
    .is("archived_at", null)
    .gte("sent_at", since)
    .limit(1);
  if (!recent?.length) {
    // the log itself: loan, staff and time (sent_at is set by the database)
    const { error } = await supabase.from("reminder_log").insert({ loan_id: loanId, created_by: user.id });
    if (error) return { error: error.message };
  }

  revalidatePath("/dashboard/compliance/reminders"); // the list shows the new status
  revalidatePath("/dashboard"); // the Dashboard's reminder count
  return { success: true };
}
