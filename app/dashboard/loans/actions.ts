"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import type { FieldErrors } from "@/lib/validation/errors";
import { validationFailure } from "@/lib/validation/errors";
import { manilaToday } from "@/lib/format"; // today in Manila (business day)
import { candidateKey, loadDefaultCandidates } from "@/lib/loans/default-candidates"; // L30: the loans the default check would change

export type ActionState = {
  error?: string;
  fieldErrors?: FieldErrors;
  success?: boolean;
  id?: string;
  receiptNumber?: string;
};

// All loan lifecycle writes go through SECURITY DEFINER database functions
// (migration 0017). They check the caller's role, keep loan, inventory, cash
// flow and appraisal pool in step in one transaction, and are the only path
// that can change a loan once it is saved (records are locked for staff).

const createSchema = z.object({
  customer_id: z.string().uuid("Select a customer"),
  appraisal_item_id: z.string().uuid("Select an item"),
  principal_amount: z.coerce.number().gt(0, "Loan amount must be greater than 0"),
  vault_location: z.string().trim().max(80).optional().or(z.literal("")),
});

// L20: what staff see when a loan action fails. The database's own messages (raised with RAISE EXCEPTION,
// code P0001) are written for staff, e.g. "Payment of 5000 exceeds the total owed (4300.00)", so they are shown.
// A permission refusal (42501) gets a plain sentence. Anything else is technical: it goes to the server log only.
function friendlyError(action: string, error: { code?: string; message: string } | null): string {
  if (error?.code === "P0001" && error.message) return error.message; // a business rule said no, in plain words
  if (error?.code === "42501") return "You don't have permission to do that. Ask an Admin if you need it.";
  console.error(`${action} failed:`, error?.code, error?.message); // the details stay in the server log
  return `Couldn't ${action}, so nothing was changed. Reload the page to see the latest balance, then try again. If it keeps happening, tell an Admin.`;
}

function revalidateLoan(id?: string) {
  revalidatePath("/dashboard/loans");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/dashboard/loans/${id}`);
}

// PB-17: create a pawn loan against an available appraisal.
export async function createLoan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["cashier", "admin"]);
  const parsed = createSchema.safeParse({
    customer_id: formData.get("customer_id"),
    appraisal_item_id: formData.get("appraisal_item_id"),
    principal_amount: formData.get("principal_amount"),
    vault_location: formData.get("vault_location") ?? undefined,
  });
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createClient();
  const { data: loanId, error } = await supabase.rpc("create_pawn_loan", {
    p_customer_id: parsed.data.customer_id,
    p_appraisal_item_id: parsed.data.appraisal_item_id,
    p_principal_amount: parsed.data.principal_amount,
    p_vault_location: parsed.data.vault_location || "Vault A",
  });
  if (error || !loanId) return { error: friendlyError("create the loan", error) }; // L20

  // PB-32: the placeholder AML rule (3+ loans within 24 hours) is checked by create_pawn_loan itself since migration
  // 0032 (#6), so the flag is saved together with the loan. The app no longer saves it in a second step.

  revalidatePath("/dashboard/appraisals");
  revalidateLoan(loanId);
  return { success: true, id: loanId };
}

const paymentSchema = z.object({
  loan_id: z.string().uuid(),
  amount: z.coerce.number().gt(0, "Payment amount must be greater than 0"),
  lost_ticket: z.boolean(),
  id_number_confirm: z.string().trim().optional(),
});

// PB-18: interest owed (including any accrued past maturity) is settled first.
export async function recordPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["cashier", "admin"]);
  const parsed = paymentSchema.safeParse({
    loan_id: formData.get("loan_id"),
    amount: formData.get("amount"),
    lost_ticket: formData.get("lost_ticket") === "on",
    id_number_confirm: formData.get("id_number_confirm") ?? undefined,
  });
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_payment", {
    p_loan_id: parsed.data.loan_id,
    p_amount: parsed.data.amount,
    p_lost_ticket: parsed.data.lost_ticket,
    p_id_confirm: parsed.data.id_number_confirm ?? undefined,
    p_request_id: requestIdFrom(formData), // #31 the same submit twice = one payment, same receipt
  });
  if (error) return { error: friendlyError("record the payment", error) }; // L20
  revalidateLoan(parsed.data.loan_id);
  return { success: true, id: parsed.data.loan_id, receiptNumber: (data as { receipt_number?: string } | null)?.receipt_number };
}

function loanIdFrom(formData: FormData): string | null {
  const id = String(formData.get("loan_id") ?? "");
  return z.string().uuid().safeParse(id).success ? id : null;
}
// #31: the form's one-time id (components/request-id.tsx); missing or broken = none, and the database saves normally
function requestIdFrom(formData: FormData): string | undefined {
  const id = String(formData.get("request_id") ?? "");
  return z.string().uuid().safeParse(id).success ? id : undefined;
}
// #31: the due date the page showed (YYYY-MM-DD); the database refuses if the loan changed since
function expectedMaturityFrom(formData: FormData): string | undefined {
  const d = String(formData.get("expected_maturity") ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
}

// PB-19: pay-and-renew.
export async function processExtension(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["cashier", "admin"]);
  const id = loanIdFrom(formData);
  if (!id) return { error: "Loan not found. Reload the page." };
  const supabase = await createClient();
  // #31: one-time id (a retry renews once) + the due date the page showed (another tab already renewed = refused)
  const { error } = await supabase.rpc("renew_loan", { p_loan_id: id, p_request_id: requestIdFrom(formData), p_expected_maturity: expectedMaturityFrom(formData) });
  if (error) return { error: friendlyError("renew the loan", error) }; // L20
  revalidateLoan(id);
  return { success: true, id };
}

// Item 8: capitalize unpaid interest and extend one term.
export async function capitalizeLoan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["cashier", "admin"]);
  const id = loanIdFrom(formData);
  if (!id) return { error: "Loan not found. Reload the page." };
  const supabase = await createClient();
  // #31: same protection as Renew
  const { error } = await supabase.rpc("capitalize_loan", { p_loan_id: id, p_request_id: requestIdFrom(formData), p_expected_maturity: expectedMaturityFrom(formData) });
  if (error) return { error: friendlyError("capitalize the loan", error) }; // L20
  revalidateLoan(id);
  return { success: true, id };
}

// Item 7: reinstate a defaulted loan.
export async function reinstateLoan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["cashier", "admin"]);
  const id = loanIdFrom(formData);
  if (!id) return { error: "Loan not found. Reload the page." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reinstate_loan", { p_loan_id: id });
  if (error) return { error: friendlyError("reinstate the loan", error) }; // L20
  revalidateLoan(id);
  revalidatePath("/dashboard/inventory");
  return { success: true, id };
}

// Admin confirms a default as final (the item now belongs to the shop).
export async function forfeitLoan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["admin"]);
  const id = loanIdFrom(formData);
  if (!id) return { error: "Loan not found. Reload the page." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("forfeit_loan", { p_loan_id: id });
  if (error) return { error: friendlyError("forfeit the loan", error) }; // L20
  revalidateLoan(id);
  return { success: true, id };
}

// PB-20: redeem a fully paid loan.
export async function redeemLoan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["cashier", "admin"]);
  const id = loanIdFrom(formData);
  if (!id) return { error: "Loan not found. Reload the page." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("redeem_loan", {
    p_loan_id: id,
    p_lost_ticket: formData.get("lost_ticket") === "on",
    p_id_confirm: String(formData.get("id_number_confirm") ?? "") || undefined,
  });
  if (error) return { error: friendlyError("redeem the loan", error) }; // L20
  revalidateLoan(id);
  return { success: true, id };
}

const adminLoanSchema = z.object({
  loan_id: z.string().uuid(),
  principal_amount: z.coerce.number().gt(0, "Principal must be greater than 0"),
  interest_rate_percent: z.coerce.number().min(0, "Interest rate cannot be negative"),
  maturity_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  reason: z.string().trim().min(5, "Write a reason of at least 5 characters"),
});

// Item 5: Admin correction with a written reason; before/after goes to the audit trail.
export async function adminEditLoan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["admin"]);
  const parsed = adminLoanSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_edit_loan", {
    p_id: parsed.data.loan_id,
    p_principal_amount: parsed.data.principal_amount,
    p_interest_rate_percent: parsed.data.interest_rate_percent,
    p_maturity_date: parsed.data.maturity_date,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: friendlyError("save the correction", error) }; // L20
  revalidateLoan(parsed.data.loan_id);
  return { success: true, id: parsed.data.loan_id };
}

const adminPaymentSchema = z.object({
  payment_id: z.string().uuid(),
  loan_id: z.string().uuid(),
  amount: z.coerce.number().gt(0, "Amount must be greater than 0"),
  reason: z.string().trim().min(5, "Write a reason of at least 5 characters"),
});

export async function adminEditPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["admin"]);
  const parsed = adminPaymentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_edit_payment", {
    p_id: parsed.data.payment_id,
    p_amount: parsed.data.amount,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: friendlyError("save the payment correction", error) }; // L20
  revalidateLoan(parsed.data.loan_id);
  return { success: true, id: parsed.data.loan_id };
}

// L0 (Phase 0): default detection no longer runs when someone OPENS the Loans list, because opening a list
// must never change loans. A1: since Matt's fix #7 the database runs it by itself every day at 12:05 AM;
// an Admin can still run it on purpose here ("Check for defaults"). Same database function (run_default_detection).
export type DefaultCheckState = { error?: string; success?: boolean; message?: string };

export async function checkDefaultsNow(_prev: DefaultCheckState, formData: FormData): Promise<DefaultCheckState> {
  void _prev; // not used: every check starts fresh
  await requireRole(["admin"]);
  const supabase = await createClient();

  // L30: work out the list again right now with the same rule the preview used (read-only)
  // A1: fully paid loans are no longer in this list (the database skips them since Matt's fix #1), so they don't block it
  const { error: readError, candidates } = await loadDefaultCandidates(manilaToday());
  if (readError) return { error: friendlyError("check the loans", readError) };

  // L30: nothing to do -> don't call the database at all
  if (candidates.length === 0) return { success: true, message: "Nothing to change. No active or renewed loan that still owes money is past its grace period." };
  // L30: the Admin confirmed the list shown on the page. If it changed since (a payment, a renewal, a new day),
  // stop, so nothing is defaulted that the Admin didn't see.
  if (String(formData.get("expected") ?? "") !== candidateKey(candidates)) {
    return { error: `Not run: the list changed since the page loaded (now ${candidates.length} loan${candidates.length === 1 ? "" : "s"}). Reload the page and check the list again.` };
  }

  const { data, error } = await supabase.rpc("run_default_detection");
  if (error) return { error: friendlyError("run the default check", error) };
  revalidateLoan();
  revalidatePath("/dashboard/inventory");
  // A1: since Matt's fix #32 the function returns how many LOANS it defaulted, so the message uses that number
  // (the confirmed list's count is only a fallback if the database sends back nothing)
  const n = typeof data === "number" ? data : candidates.length;
  return { success: true, message: `Default check done. ${n} loan${n === 1 ? "" : "s"} past the grace period moved to Defaulted. Their items stay in the vault until an Admin forfeits each one. Each change is in the audit trail.` };
}
