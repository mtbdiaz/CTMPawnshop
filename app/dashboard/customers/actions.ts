"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { customerSchema } from "@/lib/validation/customer";
import { runAmlCheck } from "@/lib/customers/aml";

export type ActionState = { error?: string; success?: boolean; customerId?: string };

function parseCustomerForm(formData: FormData) {
  return customerSchema.safeParse({
    full_name: formData.get("full_name"),
    address: formData.get("address"),
    contact_number: formData.get("contact_number"),
    email: formData.get("email"),
    date_of_birth: formData.get("date_of_birth"),
    id_type: formData.get("id_type"),
    id_number: formData.get("id_number"),
  });
}

// PB-7 + PB-8: register a new customer, run the AML check as part of registration.
export async function createCustomer(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["operator", "admin"]);
  const parsed = parseCustomerForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const aml = runAmlCheck(parsed.data.full_name, parsed.data.id_number);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({
      full_name: parsed.data.full_name,
      address: parsed.data.address,
      contact_number: parsed.data.contact_number,
      email: parsed.data.email || null,
      date_of_birth: parsed.data.date_of_birth || null,
      id_type: parsed.data.id_type,
      id_number: parsed.data.id_number,
      aml_status: aml.status,
      aml_checked_at: new Date().toISOString(),
      aml_notes: aml.notes,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/dashboard/customers");
  return { success: true, customerId: data.id };
}

// PB-9: update an existing customer's profile.
export async function updateCustomer(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["operator", "admin"]);
  const customerId = String(formData.get("customer_id") ?? "");
  const parsed = parseCustomerForm(formData);
  if (!customerId) return { error: "Missing customer id" };
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({
      full_name: parsed.data.full_name,
      address: parsed.data.address,
      contact_number: parsed.data.contact_number,
      email: parsed.data.email || null,
      date_of_birth: parsed.data.date_of_birth || null,
      id_type: parsed.data.id_type,
      id_number: parsed.data.id_number,
    })
    .eq("id", customerId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/customers");
  revalidatePath(`/dashboard/customers/${customerId}`);
  return { success: true, customerId };
}

// PB-11 support: Admin can set/clear the blacklist flag (used by the
// automatic blacklist check at loan/appraisal time in later sprints).
export async function setBlacklistStatus(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["admin"]);
  const customerId = String(formData.get("customer_id") ?? "");
  const isBlacklisted = formData.get("is_blacklisted") === "on";
  const reason = String(formData.get("blacklist_reason") ?? "").trim();
  if (!customerId) return { error: "Missing customer id" };
  if (isBlacklisted && !reason) return { error: "A reason is required to blacklist a customer" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({
      is_blacklisted: isBlacklisted,
      blacklist_reason: isBlacklisted ? reason : null,
    })
    .eq("id", customerId);

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/customers/${customerId}`);
  return { success: true, customerId };
}
