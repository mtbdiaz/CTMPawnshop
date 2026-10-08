"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import type { FieldErrors } from "@/lib/validation/errors";
import { validationFailure } from "@/lib/validation/errors";
import { isSuspiciousLoanVelocity } from "@/lib/compliance/suspicious";

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
  if (error || !loanId) return { error: error?.message ?? "Could not create the loan" };

  // PB-32: placeholder AML velocity rule.
  const { data: recent } = await supabase.from("loans").select("created_at").eq("customer_id", parsed.data.customer_id);
  if (isSuspiciousLoanVelocity((recent ?? []).map((l) => new Date(l.created_at)))) {
    await supabase.from("suspicious_activity_flags").insert({
      customer_id: parsed.data.customer_id,
      loan_id: loanId,
      reason: "Unusually high number of loans opened by this customer in a short window",
    });
  }

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
  });
  if (error) return { error: error.message };
  revalidateLoan(parsed.data.loan_id);
  return { success: true, id: parsed.data.loan_id, receiptNumber: (data as { receipt_number?: string } | null)?.receipt_number };
}

function loanIdFrom(formData: FormData): string | null {
  const id = String(formData.get("loan_id") ?? "");
  return z.string().uuid().safeParse(id).success ? id : null;
}

// PB-19: pay-and-renew.
export async function processExtension(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["cashier", "admin"]);
  const id = loanIdFrom(formData);
  if (!id) return { error: "Invalid loan" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("renew_loan", { p_loan_id: id });
  if (error) return { error: error.message };
  revalidateLoan(id);
  return { success: true, id };
}

// Item 8: capitalize unpaid interest and extend one term.
export async function capitalizeLoan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["cashier", "admin"]);
  const id = loanIdFrom(formData);
  if (!id) return { error: "Invalid loan" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("capitalize_loan", { p_loan_id: id });
  if (error) return { error: error.message };
  revalidateLoan(id);
  return { success: true, id };
}

// Item 7: reinstate a defaulted loan.
export async function reinstateLoan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["cashier", "admin"]);
  const id = loanIdFrom(formData);
  if (!id) return { error: "Invalid loan" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reinstate_loan", { p_loan_id: id });
  if (error) return { error: error.message };
  revalidateLoan(id);
  revalidatePath("/dashboard/inventory");
  return { success: true, id };
}

// Admin confirms a default as final (the item now belongs to the shop).
export async function forfeitLoan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["admin"]);
  const id = loanIdFrom(formData);
  if (!id) return { error: "Invalid loan" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("forfeit_loan", { p_loan_id: id });
  if (error) return { error: error.message };
  revalidateLoan(id);
  return { success: true, id };
}

// PB-20: redeem a fully paid loan.
export async function redeemLoan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["cashier", "admin"]);
  const id = loanIdFrom(formData);
  if (!id) return { error: "Invalid loan" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("redeem_loan", {
    p_loan_id: id,
    p_lost_ticket: formData.get("lost_ticket") === "on",
    p_id_confirm: String(formData.get("id_number_confirm") ?? "") || undefined,
  });
  if (error) return { error: error.message };
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
  if (error) return { error: error.message };
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
  if (error) return { error: error.message };
  revalidateLoan(parsed.data.loan_id);
  return { success: true, id: parsed.data.loan_id };
}

// PB-21: opportunistic default detection (no scheduler, see DECISIONS_LOG.md).
export async function runDefaultDetection(): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("run_default_detection");
}
