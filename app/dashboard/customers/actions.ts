"use server";

import { validationFailure, type FieldErrors } from "@/lib/validation/errors";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { allowRequest, TOO_MANY } from "@/lib/rate-limit"; // #22: rate limiting
// also import the shared phone rule we just exported
import { customerSchema, requiredDateOfBirthSchema, idNumberError, phPhoneSchema, joinName, nameFields, MAX } from "@/lib/validation/customer"; // F4: MAX = length limits; NP: joinName + nameFields = the name in parts
import { runAmlCheck } from "@/lib/customers/aml";
// P3: which roles may see a full government ID number
import { ID_REVEAL_ROLES } from "@/lib/customers/id-privacy";

// the result the server sends back to the form after Register / Save
export type ActionState = {
  error?: string; // message shown in a red box at the bottom of the form
  fieldErrors?: FieldErrors; // red message under a specific field
  success?: boolean; // true when it saved
  customerId?: string; // the new customer's id, used to open their profile
  amlFlagged?: boolean; // F3: true when the AML check at registration found a possible watchlist match
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
    first_name: formData.get("first_name"), // NP: the name in parts (migration 0042)
    middle_name: formData.get("middle_name") ?? "", // optional
    last_name: formData.get("last_name"),
    suffix: formData.get("suffix") ?? "", // optional, "" = none
    address: formData.get("address"),
    contact_number: formData.get("contact_number"),
    email: formData.get("email"),
    date_of_birth: formData.get("date_of_birth"),
    id_type: formData.get("id_type"),
    id_number: formData.get("id_number"),
  });
}

// LV2: who already has this phone number or this ID, checked while the Register form is being filled in (same
// matching rules as createCustomer below, which still checks again on Register). null = nobody.
// { limited: true } = over 60 checks a minute (#22). Only the name and the C-number are sent back.
export type DuplicateHit = { id: string; name: string; customerNo: number; archived: boolean };
export async function checkCustomerDuplicate(
  kind: "phone" | "id",
  value: string,
  idType?: string,
): Promise<DuplicateHit | null | { limited: true }> {
  await requireRole(["operator", "cashier", "admin"]); // the roles that can register
  if (!(await allowRequest("search"))) return { limited: true };
  if (kind === "phone") {
    const phone = phPhoneSchema.safeParse(value); // the same phone rule as the form
    if (!phone.success) return null; // a wrong format is shown by the form itself
    const { data } = await (await createClient())
      .from("customers")
      .select("id, full_name, customer_no, contact_number, archived_at")
      .ilike("contact_number", loosePattern(phone.data.slice(1))) // numbers that look similar (without the first 0)
      .limit(20);
    const match = (data ?? []).find((c) => normalPhone(c.contact_number) === phone.data); // the same number once cleaned
    return match ? { id: match.id, name: match.full_name, customerNo: match.customer_no, archived: !!match.archived_at } : null;
  }
  if (!idType || idNumberError(idType, value)) return null; // wrong format: the form shows that itself
  const idClean = onlyLettersDigits(value);
  if (!idClean) return null;
  const { data } = await createAdminClient() // #17: id_number is only readable on the server
    .from("customers")
    .select("id, full_name, customer_no, id_number, archived_at")
    .eq("id_type", idType)
    .ilike("id_number", loosePattern(idClean))
    .limit(20);
  const match = (data ?? []).find((c) => onlyLettersDigits(c.id_number) === idClean); // the same ID once cleaned
  return match ? { id: match.id, name: match.full_name, customerNo: match.customer_no, archived: !!match.archived_at } : null;
}

// PB-7 + PB-8: register a new customer, run the AML check as part of registration.
export async function createCustomer(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // RC1: a Cashier may register too (owner decision Nov 11, migration 0041), so New Loan can register a walk-in customer
  const user = await requireRole(["operator", "cashier", "admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
  const parsed = parseCustomerForm(formData);
  if (!parsed.success) return validationFailure(parsed.error);

  // NP: the one-line name, built the same way the database builds full_name ("Juan B. Dela Cruz Jr.")
  const fullName = joinName(parsed.data.first_name, parsed.data.middle_name, parsed.data.last_name, parsed.data.suffix);
  // the AML check gets every part in full (the whole middle name, not only its initial)
  const aml = runAmlCheck([parsed.data.first_name, parsed.data.middle_name, parsed.data.last_name, parsed.data.suffix].filter(Boolean).join(" "), parsed.data.id_number);

  const supabase = await createClient();
  
  // C6: stop double registration of the same person
  const idClean = onlyLettersDigits(parsed.data.id_number); // the typed ID with no dashes or spaces
  if (idClean) { // only check if the ID has letters or numbers in it
    const { data: sameId } = await createAdminClient() // #17: id_number is only readable on the server
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
      first_name: parsed.data.first_name, // NP: the parts are saved...
      middle_name: parsed.data.middle_name || null, // empty = no middle name
      last_name: parsed.data.last_name,
      suffix: parsed.data.suffix || null, // empty = no suffix
      full_name: fullName, // ...and the database rebuilds full_name from them anyway (trigger customers_build_name)
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

  if (error) {
    console.error("createCustomer failed:", error.message); // F12: the technical details stay in the server log for the developers
    return { error: "Couldn't register the customer, so nothing was saved. Please try again. If it keeps happening, tell an Admin." }; // F12: plain message for staff
  }

  revalidatePath("/dashboard/customers");
  return { success: true, customerId: data.id, amlFlagged: aml.status === "flagged" }; // F3: tell the form what AML found
}

// PB-9: update contact details. Name and ID lock after registration
// (database trigger); only an Admin can correct them, with a reason.
// Phone fix: here the number is only checked loosely (not empty). The full
// 09XXXXXXXXX rule runs in updateCustomer below, and only when the number changed.
const contactSchema = z.object({
  address: z.string().trim().min(1, "Address is required").max(MAX.address, `Address can be at most ${MAX.address} characters`), // F4
  contact_number: z.string().trim().min(1, "Contact number is required"),
  email: z.string().trim().max(MAX.email, `Email can be at most ${MAX.email} characters`).email("Enter a valid email").optional().or(z.literal("")), // F4
  date_of_birth: z.string().trim().optional().or(z.literal("")),
});

// removes spaces and dashes, the same cleaning the phone rule does
const cleanPhone = (value: string) => value.replace(/[\s-]/g, "");

export async function updateCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["operator", "admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
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
  const { data: current } = await supabase.from("customers").select("contact_number, date_of_birth").eq("id", customerId).maybeSingle(); // F11: also the saved birthday
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

  // F16: the birthday is required here too (email is the only optional field). An older record saved without one
  // must get one the next time it's edited. A saved birthday that wasn't changed is kept as it is (same idea as the phone).
  const dobChanged = (parsed.data.date_of_birth || null) !== (current?.date_of_birth ?? null); // true if staff typed a different birthday
  if (!parsed.data.date_of_birth || dobChanged) { // empty, or changed: check it
    const dob = requiredDateOfBirthSchema.safeParse(parsed.data.date_of_birth ?? ""); // required, real date, and 18 or older (F15)
    if (!dob.success) {
      const message = dob.error.issues[0]?.message ?? "Enter a real date of birth"; // the rule's message
      return { error: message, fieldErrors: { date_of_birth: message } }; // shows under the date field, nothing saved
    } // end of the failed check
  } // end of the birthday check

  const { error } = await supabase
    .from("customers")
    .update({
      address: parsed.data.address,
      contact_number: contactNumber,
      email: parsed.data.email || null,
      date_of_birth: parsed.data.date_of_birth || null,
    })
    .eq("id", customerId);
  if (error) {
    console.error("updateCustomer failed:", error.message); // F12: technical details stay in the server log
    return { error: "Couldn't save the changes, so nothing was changed. Please try again. If it keeps happening, tell an Admin." }; // F12: plain message for staff
  }

  revalidatePath("/dashboard/customers");
  revalidatePath(`/dashboard/customers/${customerId}`);
  return { success: true, customerId };
}

const identitySchema = z.object({
  customer_id: z.string().uuid("Customer not found."), // PR12: plain message instead of "Invalid UUID" if the link is broken
  ...nameFields, // NP: First, Middle, Last and Suffix, the same rules as Register (PR4)
  id_type: z.string().trim().min(1, "ID type is required"),
  id_number: z.string().trim().max(MAX.id_number, `ID number can be at most ${MAX.id_number} characters`), // PR4: may be empty = keep the current number; F4: length limit
  reason: z.string().trim().min(5, "Write a reason of at least 5 characters"),
  loaded_at: z.string().optional(), // #21: when the page loaded this customer (its updated_at); empty = no check
});

// Item 5: Admin-only identity correction, reason required, before/after audited.
export async function adminEditCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
  const parsed = identitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(parsed.error);
  const supabase = await createClient();

  // F10: if the Admin changes the ID type or number, the new one must fit the format for its type.
  // If only the name is being fixed, the saved ID is left alone even if it's an old one that doesn't fit.
  const { data: current } = await createAdminClient().from("customers").select("first_name, middle_name, last_name, suffix, id_type, id_number").eq("id", parsed.data.customer_id).maybeSingle(); // the name and ID saved now, before this correction
  if (!current) return { error: "Customer not found." }; // PR4: wrong or deleted customer id
  // PR4: an empty "New ID number" means keep the current number
  parsed.data.id_number = parsed.data.id_number || current.id_number;
  const cleanId = (v: string) => v.replace(/[\s-]/g, "").toUpperCase(); // ignore dashes, spaces and capitals
  // PR4: stop a "correction" that changes nothing (same name, same ID type, same number)
  // NP: the name is the same when all four parts are the same (empty and nothing count as the same)
  const sameName = (["first_name", "middle_name", "last_name", "suffix"] as const).every((k) => (current[k] ?? "") === parsed.data[k]);
  if (sameName && current.id_type === parsed.data.id_type && cleanId(current.id_number) === cleanId(parsed.data.id_number)) {
    return { error: "Nothing to correct: the name and ID are the same as what's saved now." }; // nothing saved, nothing written to the audit trail
  } // end of the nothing-changed check
  const idChanged = current.id_type !== parsed.data.id_type || cleanId(current.id_number) !== cleanId(parsed.data.id_number); // true if the type or the number is different
  if (idChanged) { // only check the format when the ID itself is being changed
    const formatError = idNumberError(parsed.data.id_type, parsed.data.id_number); // null = format is fine
    if (formatError) return { error: formatError, fieldErrors: { id_number: formatError } }; // red text under ID number, nothing saved
  } // end of the ID format check

  // C6b: the same duplicate-ID check as Register, so an Admin correction can't copy another customer's ID
  const idClean = onlyLettersDigits(parsed.data.id_number); // the new ID with no dashes or spaces
  if (idClean) { // only check if the ID has letters or numbers in it
    const { data: sameId } = await createAdminClient() // #17: id_number is only readable on the server
      .from("customers") // the customers table
      .select("id, full_name, id_number") // only the columns we need
      .eq("id_type", parsed.data.id_type) // same ID type
      .neq("id", parsed.data.customer_id) // skip this customer (keeping their own ID is fine)
      .ilike("id_number", loosePattern(idClean)) // ID number that looks similar
      .limit(20); // a few candidates is enough
    const match = (sameId ?? []).find((c) => onlyLettersDigits(c.id_number) === idClean); // the exact same ID once cleaned
    if (match) { // another customer already has this ID, so stop
      const message = `This ID is already registered to ${match.full_name}. Check the ID card again.`; // says who has it
      return { error: message, fieldErrors: { id_number: "This ID is already registered" } }; // red box + red text under the field, nothing saved
    } // end of the match
  } // end of the duplicate check

  const { error } = await supabase.rpc("admin_edit_customer", {
    p_id: parsed.data.customer_id,
    p_full_name: joinName(parsed.data.first_name, parsed.data.middle_name, parsed.data.last_name, parsed.data.suffix), // NP: for old callers; the parts below are what is saved
    p_id_type: parsed.data.id_type,
    p_id_number: parsed.data.id_number,
    p_contact_number: "",
    p_address: "",
    p_reason: parsed.data.reason,
    // #21: the database refuses if someone changed this customer after the page was opened
    p_expected_updated_at: parsed.data.loaded_at || undefined,
    // NP (0042): the name parts. The database builds full_name from them
    p_first_name: parsed.data.first_name,
    p_middle_name: parsed.data.middle_name || undefined, // empty = no middle name
    p_last_name: parsed.data.last_name,
    p_suffix: parsed.data.suffix || undefined, // empty = no suffix
  });
  if (error) return { error: error.message }; // plain words, e.g. "Someone changed this customer after you opened the page…"
  revalidatePath(`/dashboard/customers/${parsed.data.customer_id}`);
  revalidatePath("/dashboard/customers");
  return { success: true, customerId: parsed.data.customer_id };
}

// P3: sends ONE customer's full ID number, only after checking the role on the server.
// The list and profile never send full IDs to the browser; this is the only way to get one, one at a time.
export async function revealCustomerId(customerId: string): Promise<{ idNumber?: string; error?: string }> {
  await requireRole(ID_REVEAL_ROLES); // not allowed -> sent back to the Dashboard with "You don't have access"
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
  if (!z.string().uuid().safeParse(customerId).success) return { error: "Customer not found." }; // must look like a real customer id
  const supabase = await createClient();
  // #19: the database checks the role again and writes a VIEW row to the audit trail for every reveal
  const { data, error } = await supabase.rpc("reveal_customer_id", { p_customer_id: customerId });
  if (error || !data) return { error: "Customer not found." };
  return { idNumber: data }; // the full number, for this one customer only
}

// PB-11 support: Admin can set/clear the blacklist flag (used by the
// automatic blacklist check at loan/appraisal time in later sprints).
export async function setBlacklistStatus(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(["admin"]);
  if (!(await allowRequest("save"))) return { error: TOO_MANY }; // #22: at most 30 saves a minute per account
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