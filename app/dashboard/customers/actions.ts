"use server";

import { validationFailure, type FieldErrors } from "@/lib/validation/errors";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { customerSchema } from "@/lib/validation/customer";
import { runAmlCheck } from "@/lib/customers/aml";

export type ActionState = { error?: string; fieldErrors?: FieldErrors; success?: boolean; customerId?: string };

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
  if (!parsed.success) return validationFailure(parsed.error);

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

// PB-9: update contact details. Name and ID lock after registration
// (database trigger); only an Admin can correct them, with a reason.
const contactSchema = z.object({
  address: z.string().trim().min(1, "Address is required"),
  contact_number: z.string().trim().min(1, "Contact number is required"),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  date_of_birth: z.string().trim().optional().or(z.literal("")),
});

export async function updateCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["operator", "admin"]);
  const customerId = String(formData.get("customer_id") ?? "");
  if (!customerId) return { error: "Missing customer id" };
  const parsed = contactSchema.safeParse({
    address: formData.get("address"),
    contact_number: formData.get("contact_number"),
    email: formData.get("email") ?? undefined,
    date_of_birth: formData.get("date_of_birth") ?? undefined,
  });
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({
      address: parsed.data.address,
      contact_number: parsed.data.contact_number,
      email: parsed.data.email || null,
      date_of_birth: parsed.data.date_of_birth || null,
    })
    .eq("id", customerId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/customers");
  revalidatePath(`/dashboard/customers/${customerId}`);
  return { success: true, customerId };
}

const identitySchema = z.object({
  customer_id: z.string().uuid(),
  full_name: z.string().trim().min(1, "Full name is required"),
  id_type: z.string().trim().min(1, "ID type is required"),
  id_number: z.string().trim().min(1, "ID number is required"),
  reason: z.string().trim().min(5, "Write a reason of at least 5 characters"),
});

// Item 5: Admin-only identity correction, reason required, before/after audited.
export async function adminEditCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["admin"]);
  const parsed = identitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_edit_customer", {
    p_id: parsed.data.customer_id,
    p_full_name: parsed.data.full_name,
    p_id_type: parsed.data.id_type,
    p_id_number: parsed.data.id_number,
    p_contact_number: "",
    p_address: "",
    p_reason: parsed.data.reason,
  });
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/customers/${parsed.data.customer_id}`);
  revalidatePath("/dashboard/customers");
  return { success: true, customerId: parsed.data.customer_id };
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
  if (isBlacklisted && !reason) {
    const message = "A reason is required to blacklist a customer";
    return { error: message, fieldErrors: { blacklist_reason: message } };
  }

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
  revalidatePath("/dashboard/customers");
  return { success: true, customerId };
}
