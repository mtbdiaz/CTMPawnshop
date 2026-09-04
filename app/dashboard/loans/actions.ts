"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { createLoanSchema, paymentSchema, extensionSchema, redeemSchema } from "@/lib/validation/loan";
import { getBlacklistStatus } from "@/lib/customers/blacklist";
import {
  calculateMaturityDate,
  calculateInterestDue,
  applyPayment,
  validatePaymentAmount,
  calculateExtension,
  generateTicketNumber,
  generateReceiptNumber,
} from "@/lib/loans/calculations";
import { verifyLostTicketId } from "@/lib/loans/lost-ticket";
import { isPastGracePeriod } from "@/lib/loans/default-detection";

export type ActionState = { error?: string; success?: boolean; id?: string };

// PB-17: create a pawn loan against an appraised, unflagged item. Also
// creates the matching inventory record and initial cash flow entry (AC2).
export async function createLoan(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["cashier", "admin"]);
  const parsed = createLoanSchema.safeParse({
    customer_id: formData.get("customer_id"),
    appraisal_item_id: formData.get("appraisal_item_id"),
    principal_amount: formData.get("principal_amount"),
    vault_location: formData.get("vault_location"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const blacklist = await getBlacklistStatus(parsed.data.customer_id);
  if (blacklist.isBlacklisted) {
    return { error: `Customer is blacklisted: ${blacklist.reason ?? "no reason on file"}. Loan blocked.` };
  }

  const supabase = await createClient();

  const { data: appraisal } = await supabase
    .from("appraisal_items")
    .select("*")
    .eq("id", parsed.data.appraisal_item_id)
    .single();
  if (!appraisal) return { error: "Appraised item not found" };
  if (appraisal.customer_id !== parsed.data.customer_id) {
    return { error: "That appraisal item does not belong to the selected customer" };
  }
  if (appraisal.is_counterfeit_risk && appraisal.counterfeit_resolution !== "cleared") {
    return { error: "This item is flagged as a counterfeit risk and has not been cleared by an Admin. Loan blocked." };
  }
  if (parsed.data.principal_amount > appraisal.suggested_loan_max) {
    return { error: `Loan amount exceeds the suggested maximum of ${appraisal.suggested_loan_max}` };
  }

  const { data: existingLoan } = await supabase
    .from("loans")
    .select("id")
    .eq("appraisal_item_id", parsed.data.appraisal_item_id)
    .in("status", ["active", "extended"])
    .maybeSingle();
  if (existingLoan) return { error: "This item already has an active loan" };

  const { data: settings } = await supabase
    .from("system_settings")
    .select("interest_rate_percent, grace_period_days")
    .eq("id", 1)
    .single();
  if (!settings) return { error: "System settings unavailable" };

  const loanDate = new Date();
  const maturityDate = calculateMaturityDate(loanDate);

  const { data: inventoryItem, error: inventoryError } = await supabase
    .from("inventory_items")
    .insert({ appraisal_item_id: parsed.data.appraisal_item_id, vault_location: parsed.data.vault_location, status: "pawned" })
    .select("id")
    .single();
  if (inventoryError || !inventoryItem) return { error: inventoryError?.message ?? "Could not register inventory item" };

  const { data: loan, error: loanError } = await supabase
    .from("loans")
    .insert({
      customer_id: parsed.data.customer_id,
      appraisal_item_id: parsed.data.appraisal_item_id,
      inventory_item_id: inventoryItem.id,
      principal_amount: parsed.data.principal_amount,
      principal_balance: parsed.data.principal_amount,
      interest_rate_percent: settings.interest_rate_percent,
      grace_period_days: settings.grace_period_days,
      loan_date: loanDate.toISOString().slice(0, 10),
      maturity_date: maturityDate.toISOString().slice(0, 10),
      ticket_number: generateTicketNumber(loanDate),
      created_by: user.id,
    })
    .select("id")
    .single();
  if (loanError || !loan) return { error: loanError?.message ?? "Could not create loan" };

  await supabase.from("cash_flow_entries").insert({
    entry_type: "loan_disbursement",
    direction: "out",
    amount: parsed.data.principal_amount,
    description: `Loan disbursed for item ${parsed.data.appraisal_item_id}`,
    related_loan_id: loan.id,
    created_by: user.id,
  });

  revalidatePath("/dashboard/loans");
  return { success: true, id: loan.id };
}

// PB-18: record a payment against an active loan; interest is settled
// first, remainder reduces principal.
export async function recordPayment(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["cashier", "admin"]);
  const parsed = paymentSchema.safeParse({
    loan_id: formData.get("loan_id"),
    amount: formData.get("amount"),
    lost_ticket: formData.get("lost_ticket") === "on",
    id_number_confirm: formData.get("id_number_confirm"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { data: loan } = await supabase.from("loans").select("*, customers(id_number)").eq("id", parsed.data.loan_id).single();
  if (!loan) return { error: "Loan not found" };
  if (loan.status !== "active" && loan.status !== "extended") {
    return { error: `Loan is ${loan.status} — no further payments accepted` };
  }

  // PB-22: lost-ticket alternate verification against the customer's ID on file.
  if (parsed.data.lost_ticket) {
    const customerIdNumber = (loan as unknown as { customers: { id_number: string } | null }).customers?.id_number;
    if (!customerIdNumber || !verifyLostTicketId(parsed.data.id_number_confirm ?? "", customerIdNumber)) {
      return { error: "ID number does not match our records for this customer. Cannot proceed without the ticket or a matching ID." };
    }
  }

  const interestDue = calculateInterestDue(loan.principal_balance, loan.interest_rate_percent);
  const validation = validatePaymentAmount(parsed.data.amount, loan.principal_balance, interestDue);
  if (!validation.ok) return { error: validation.error };

  const breakdown = applyPayment(parsed.data.amount, loan.principal_balance, interestDue);

  const { error: paymentError } = await supabase.from("loan_payments").insert({
    loan_id: loan.id,
    amount: parsed.data.amount,
    principal_portion: breakdown.principalPortion,
    interest_portion: breakdown.interestPortion,
    receipt_number: generateReceiptNumber(),
    verified_via_lost_ticket: parsed.data.lost_ticket,
    created_by: user.id,
  });
  if (paymentError) return { error: paymentError.message };

  await supabase
    .from("loans")
    .update({
      principal_balance: breakdown.newPrincipalBalance,
      ...(parsed.data.lost_ticket ? { lost_ticket_used: true } : {}),
    })
    .eq("id", loan.id);

  await supabase.from("cash_flow_entries").insert({
    entry_type: "payment_received",
    direction: "in",
    amount: parsed.data.amount,
    description: `Payment received for loan ${loan.ticket_number}`,
    related_loan_id: loan.id,
    created_by: user.id,
  });

  revalidatePath(`/dashboard/loans/${loan.id}`);
  return { success: true, id: loan.id };
}

// PB-19: extend a loan before its grace period expires — recalculates
// maturity and charges one additional interest period (paid at the
// counter as part of the extension; see DECISIONS_LOG.md).
export async function processExtension(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["cashier", "admin"]);
  const parsed = extensionSchema.safeParse({ loan_id: formData.get("loan_id") });
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const { data: loan } = await supabase.from("loans").select("*").eq("id", parsed.data.loan_id).single();
  if (!loan) return { error: "Loan not found" };
  if (loan.status !== "active" && loan.status !== "extended") {
    return { error: `Loan is ${loan.status} — cannot be extended` };
  }

  const graceDeadline = new Date(loan.maturity_date);
  graceDeadline.setDate(graceDeadline.getDate() + loan.grace_period_days);
  if (new Date() > graceDeadline) {
    return { error: "Grace period has expired — this loan can no longer be extended" };
  }

  const extension = calculateExtension(
    new Date(loan.maturity_date),
    loan.principal_balance,
    loan.interest_rate_percent,
  );

  const { error: extError } = await supabase.from("loan_extensions").insert({
    loan_id: loan.id,
    previous_maturity_date: loan.maturity_date,
    new_maturity_date: extension.newMaturityDate.toISOString().slice(0, 10),
    additional_interest_amount: extension.additionalInterestAmount,
    created_by: user.id,
  });
  if (extError) return { error: extError.message };

  await supabase
    .from("loans")
    .update({
      maturity_date: extension.newMaturityDate.toISOString().slice(0, 10),
      extension_count: loan.extension_count + 1,
      status: "extended",
    })
    .eq("id", loan.id);

  if (loan.inventory_item_id) {
    await supabase.from("inventory_items").update({ status: "extended" }).eq("id", loan.inventory_item_id);
  }

  await supabase.from("cash_flow_entries").insert({
    entry_type: "payment_received",
    direction: "in",
    amount: extension.additionalInterestAmount,
    description: `Extension interest for loan ${loan.ticket_number}`,
    related_loan_id: loan.id,
    created_by: user.id,
  });

  revalidatePath(`/dashboard/loans/${loan.id}`);
  return { success: true, id: loan.id };
}

// PB-20: redeem a fully-paid loan — closes the loan and releases the item.
export async function redeemLoan(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["cashier", "admin"]);
  const parsed = redeemSchema.safeParse({
    loan_id: formData.get("loan_id"),
    lost_ticket: formData.get("lost_ticket") === "on",
    id_number_confirm: formData.get("id_number_confirm"),
  });
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const { data: loan } = await supabase
    .from("loans")
    .select("*, customers(id_number)")
    .eq("id", parsed.data.loan_id)
    .single();
  if (!loan) return { error: "Loan not found" };
  if (loan.status !== "active" && loan.status !== "extended") {
    return { error: `Loan is ${loan.status} — cannot be redeemed` };
  }
  if (loan.principal_balance > 0) {
    return { error: `Loan still has an outstanding balance of ${loan.principal_balance}` };
  }

  if (parsed.data.lost_ticket) {
    const customerIdNumber = (loan as unknown as { customers: { id_number: string } | null }).customers?.id_number;
    if (!customerIdNumber || !verifyLostTicketId(parsed.data.id_number_confirm ?? "", customerIdNumber)) {
      return { error: "ID number does not match our records for this customer. Cannot proceed without the ticket or a matching ID." };
    }
  }

  const { error } = await supabase
    .from("loans")
    .update({ status: "redeemed", ...(parsed.data.lost_ticket ? { lost_ticket_used: true } : {}) })
    .eq("id", loan.id);
  if (error) return { error: error.message };

  if (loan.inventory_item_id) {
    await supabase.from("inventory_items").update({ status: "redeemed" }).eq("id", loan.inventory_item_id);
  }

  revalidatePath(`/dashboard/loans/${loan.id}`);
  return { success: true, id: loan.id };
}

// PB-21: detect loans past maturity + grace period with no redemption/
// extension, mark them defaulted, and move the item toward forfeiture.
// No cron/scheduler infra is available in this environment (see
// DECISIONS_LOG.md) — this runs opportunistically whenever a Cashier/Admin
// loads the Loans list, an accepted stand-in for a real scheduled job for
// this project's scope.
export async function runDefaultDetection(): Promise<void> {
  const supabase = await createClient();
  const { data: loans } = await supabase
    .from("loans")
    .select("id, maturity_date, grace_period_days, inventory_item_id")
    .in("status", ["active", "extended"]);
  if (!loans) return;

  const now = new Date();
  for (const loan of loans) {
    if (isPastGracePeriod(new Date(loan.maturity_date), loan.grace_period_days, now)) {
      await supabase.from("loans").update({ status: "defaulted" }).eq("id", loan.id);
      if (loan.inventory_item_id) {
        await supabase.from("inventory_items").update({ status: "forfeited" }).eq("id", loan.inventory_item_id);
      }
    }
  }
}
