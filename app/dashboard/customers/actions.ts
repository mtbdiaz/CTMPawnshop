"use server";

import { validationFailure, type FieldErrors } from "@/lib/validation/errors";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
// also import the shared phone rule we just exported
import { customerSchema, phPhoneSchema } from "@/lib/validation/customer";
import { runAmlCheck } from "@/lib/customers/aml";

// the result the server sends back to the form after Register / Save
export type ActionState = {
  error?: string; // message shown in a red box at the bottom of the form
  fieldErrors?: FieldErrors; // red message under a specific field
  success?: boolean; // true when it saved
  customerId?: string; // the new customer's id, used to open their profile
  // C6: filled in when a matching customer already exists (who it is, if archived, and whether the ID or the phone matched)
  duplicate?: { id: string; name: string; archived: boolean; match: "id" | "phone" };
}; // end of ActionState

// C6: keeps only letters and numbers, in capitals, so "0111-2222 333" becomes "01112222333"
const onlyLettersDigits = (value: string) => value.replace(/[^a-z0-9]/gi, "").toUpperCase();
// C6: turns any saved phone into 09XXXXXXXXX so old numbers like "+63 917 123 4567" can be compared
const normalPhone = (value: string) => {
  const digits = value.replace(/\D/g, ""); // keep digits only
  return digits.startsWith("63") && digits.length === 12 ? `0${digits.slice(2)}` : digits; // 63917... becomes 0917...
}; // end of normalPhone
// C6: search pattern that ignores dashes and spaces, so "0111" also finds "0-1-1-1" (% = anything can be here)
const loosePattern = (value: string) => `%${value.split("").join("%")}%`;

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
  
  // C6: stop double registration of the same person
  const idClean = onlyLettersDigits(parsed.data.id_number); // the typed ID with no dashes or spaces
  if (idClean) { // only check if the ID has letters or numbers in it
    const { data: sameId } = await supabase // look in the customers table
      .from("customers") // the customers table
      .select("id, full_name, id_number, archived_at") // only the columns we need
      .eq("id_type", parsed.data.id_type) // same ID type (UMID, Passport, ...)
      .ilike("id_number", loosePattern(idClean)) // ID number that looks similar
      .limit(20); // a few candidates is enough
    const match = (sameId ?? []).find((c) => onlyLettersDigits(c.id_number) === idClean); // the exact same ID once cleaned
    if (match) { // the ID already exists, so block the registration
      return {
        fieldErrors: { id_number: "This ID is already registered" }, // red text under the ID field
        duplicate: { id: match.id, name: match.full_name, archived: !!match.archived_at, match: "id" }, // tells the form who it is
      }; // stop here, nothing is saved
    } // end of the ID match
  } // end of the ID check

  if (formData.get("shared_phone") !== "on") { // skip this if the cashier ticked "shares the number"
    const { data: samePhone } = await supabase // look in the customers table
      .from("customers") // the customers table
      .select("id, full_name, contact_number, archived_at") // only the columns we need
      .ilike("contact_number", loosePattern(parsed.data.contact_number.slice(1))) // numbers that look similar (without the first 0)
      .limit(20); // a few candidates is enough
    const match = (samePhone ?? []).find((c) => normalPhone(c.contact_number) === parsed.data.contact_number); // the exact same number once cleaned
    if (match) { // the number is already used, so warn first
      return {
        fieldErrors: { contact_number: "This number is already used by another customer" }, // red text under the phone field
        duplicate: { id: match.id, name: match.full_name, archived: !!match.archived_at, match: "phone" }, // tells the form who it is
      }; // stop here, nothing is saved
    } // end of the phone match
  } // end of the phone check
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
// Phone fix: here the number is only checked loosely (not empty). The full
// 09XXXXXXXXX rule runs in updateCustomer below, and only when the number changed.
const contactSchema = z.object({
  address: z.string().trim().min(1, "Address is required"),
  contact_number: z.string().trim().min(1, "Contact number is required"),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  date_of_birth: z.string().trim().optional().or(z.literal("")),
});

// removes spaces and dashes, the same cleaning the phone rule does
const cleanPhone = (value: string) => value.replace(/[\s-]/g, "");

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

  // Phone fix: some customers were saved before the phone rule existed, so their
  // number may not fit 09XXXXXXXXX. If staff leave the number as it is, keep it and
  // let them save the other fields (e.g. a new address). If they type a NEW number,
  // it must pass the full phone rule.
  const { data: current } = await supabase.from("customers").select("contact_number").eq("id", customerId).maybeSingle();
  const saved = current?.contact_number ?? ""; // the number in the database now
  let contactNumber = saved; // keep the saved number unless it was changed
  if (cleanPhone(parsed.data.contact_number) !== cleanPhone(saved)) {
    const phone = phPhoneSchema.safeParse(parsed.data.contact_number); // full 09XXXXXXXXX check
    if (!phone.success) {
      const message = phone.error.issues[0]?.message ?? "Enter an 11-digit mobile number starting with 09";
      return { error: message, fieldErrors: { contact_number: message } }; // shows under the phone field
    }
    contactNumber = phone.data; // the cleaned new number
  }

  const { error } = await supabase
    .from("customers")
    .update({
      address: parsed.data.address,
      contact_number: contactNumber,
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