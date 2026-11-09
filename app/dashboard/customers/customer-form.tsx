"use client"; // this file runs in the browser (it uses buttons, router, form state)

import Link from "next/link"; // C6: for the "Open their profile" link
import { useState } from "react"; // F5: remembers the chosen ID type, to show the right format example
import { useRouter } from "next/navigation"; // lets us go to another page after saving
import { ActionForm, CheckboxField, Field, SelectField, SubmitButton, TextareaField } from "@/components/form"; // shared form parts (C6: added CheckboxField)
import { Alert, buttonClasses } from "@/components/ui"; // C6: the red/yellow message box; F1: button look for Cancel
import { adminEditCustomer, type ActionState } from "./actions"; // server actions + the result type
import type { Tables } from "@/lib/supabase/database.types"; // the customer row type from the database
import { ID_RULES, MIN_AGE, MAX, adultCutoff } from "@/lib/validation/customer"; // F10: the ID format rules (same list the server checks); F15: the 18+ rule; F4: MAX = length limits
import { IdReveal } from "./id-reveal"; // PR4: masked ID + eye button, for the current ID in the Admin correction form
import { idEnding } from "@/lib/customers/id-privacy"; // PR4: the last 4 characters, for screen readers

// the ID types shown in the "Valid ID type" dropdown
const ID_TYPES = [
  "PhilSys National ID",
  "UMID",
  "Passport",
  "Driver's License",
  "SSS ID",
  "PRC ID",
  "Postal ID",
  "Voter's ID",
  "Senior Citizen ID",
]; // end of ID_TYPES

// one form used for both Register customer (no customer) and Edit contact details (with customer)
export function CustomerForm({
  action, // the server action to run on submit (createCustomer or updateCustomer)
  customer, // the existing customer when editing, empty when registering
  onCancel, // F1: when given (the Register popup), a Cancel button shows next to the main button
  onSaved, // PR1: on the profile, closes the edit form after a successful save
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>; // type of the action
  customer?: Tables<"customers">; // type of the customer (optional)
  onCancel?: () => void; // what Cancel does (optional)
  onSaved?: () => void; // what to do after saving (optional)
}) {
  const router = useRouter(); // used to open the new profile after registering
  const [idType, setIdType] = useState(""); // F5: the ID type picked so far (for the format example)
  // if the customer has an old ID type not in the list, add it so the dropdown can still show it
  const idTypes = customer && !ID_TYPES.includes(customer.id_type) ? [customer.id_type, ...ID_TYPES] : ID_TYPES;

  return (
    // the form wrapper: handles submit, errors, the confirm popup and the success message
    <ActionForm
      action={action}
      className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2"
      // F3: after registering, say what the AML check actually found (it never blocks registration)
      successMessage={
        customer
          ? "Customer profile saved."
          : (s) =>
              s.amlFlagged
                ? "Customer registered. The AML check flagged a possible watchlist match, so ask an Admin to review it before lending."
                : "Customer registered. AML check: clear."
      }
      onSuccess={(state) => {
        // after registering, go straight to the new customer's profile
        if (!customer && state.customerId) router.push(`/dashboard/customers/${state.customerId}`);
        // PR1: after saving contact details on the profile, go back to the details list
        if (customer) onSaved?.();
      }}
    >
      {(state) => ( // C6: "state" = what the server sent back, so we can show who the duplicate is
      <>
      {/* F4: says once what the red * means, instead of repeating it */}
      <p className="-mb-1 text-xs text-slate-500 sm:col-span-2">
        <span className="text-red-600" aria-hidden="true">*</span> Required fields
      </p>
      {/* hidden customer id, only when editing */}
      {customer && <input type="hidden" name="customer_id" value={customer.id} />}

      {/* when editing: show the locked name and ID. when registering: show the Full name field */}
      {customer ? (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600 sm:col-span-2">
          {/* PR4: customer.id_number is already masked by the profile page ("•••• 0418"), so the full ID never reaches the browser here */}
          Name and ID are locked after registration: <span className="font-medium text-slate-900">{customer.full_name}</span>, {customer.id_type}{" "}
          <span className="font-mono">{customer.id_number}</span>. Only an Admin can correct them.
        </p>
      ) : (
        // F6: autoFocus = the cursor starts in Full name when the popup opens
        <Field label="Full name" name="full_name" required autoComplete="off" autoFocus maxLength={MAX.full_name} />
      )}
      {/* phone number field */}
      <Field
        label="Contact number"
        name="contact_number"
        type="tel"
        defaultValue={customer?.contact_number}
        required
        placeholder="09XX XXX XXXX"
        // F2: +63 and 63 numbers are accepted too (saved as 09...)
        hint="+63 numbers work too."
      />
      {/* email, address and birthday fields */}
      {/* F4: "(optional)" in the label instead of a hint line under the field */}
      {/* F4: maxLength = the box stops accepting letters at the limit (the server checks it too) */}
      <Field label="Email (optional)" name="email" type="email" defaultValue={customer?.email ?? ""} className="sm:col-span-2" maxLength={MAX.email} />
      {/* F7: 2-line box, because full addresses (purok, barangay, town) are long. Same database field as before */}
      <TextareaField label="Address" name="address" rows={2} defaultValue={customer?.address} required className="sm:col-span-2" maxLength={MAX.address} />
      {/* F15 + F16: required on Register AND Edit (email is the only optional field). 18+ rule.
          min/max = the date picker won't offer days before 1900 or anyone younger than 18 (the server checks this too).
          If an old record's saved birthday is outside that range, the limits are left off so the rest of the form can still be saved. */}
      <Field
        label="Date of birth"
        name="date_of_birth"
        type="date"
        required
        min={!customer?.date_of_birth || customer.date_of_birth >= "1900-01-01" ? "1900-01-01" : undefined}
        max={!customer?.date_of_birth || customer.date_of_birth <= adultCutoff() ? adultCutoff() : undefined}
        defaultValue={customer?.date_of_birth ?? ""}
        hint={`Customers must be ${MIN_AGE} or older.`}
      />
      {/* ID type and ID number, only when registering (locked after) */}
      {!customer && (
        <>
          {/* F5: onChange remembers the type, to show its format example under ID number */}
          <SelectField label="Valid ID type" name="id_type" defaultValue="" required onChange={(e) => setIdType(e.target.value)}>
            <option value="" disabled>
              Select an ID type
            </option>
            {idTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </SelectField>
          <Field
            label="ID number"
            name="id_number"
        maxLength={MAX.id_number} // F4: length limit
            required
            className="sm:col-span-2"
            // F10: the expected format for the chosen type (the server blocks a wrong one) + why it matters. F13: says who can correct it later
            hint={`${ID_RULES[idType] ? `Format: ${ID_RULES[idType].example}.` : "Pick the ID type first."} Used to verify identity if the pawn ticket is lost. After registration, only an Admin can correct it.`}
          />
        </>
      )}

      {/* C6: only on Register (not Edit), and only when the server found a match */}
      {!customer && state.duplicate && (
        // full-width row in the form
        <div className="sm:col-span-2">
          {/* red box if the ID matched (blocked), yellow box if only the phone matched (warning) */}
          <Alert
            tone={state.duplicate.match === "id" ? "danger" : "warning"}
            title={state.duplicate.match === "id" ? "This customer is already registered" : "This contact number is already in use"}
          >
            {/* the explanation text */}
            <p>
              {/* first part of the sentence */}
              {state.duplicate.match === "id" ? "The same ID belongs to " : "The same number belongs to "}
              {/* the existing customer's name in bold */}
              <span className="font-medium">{state.duplicate.name}</span>
              {/* adds "(archived)" if that customer was archived, then the period */}
              {state.duplicate.archived && " (archived)"}.{" "}
              {/* what the cashier should do next */}
              {state.duplicate.match === "id"
                ? "Open their profile instead of registering them again."
                : "If they share a phone (for example, family members), tick the box below and register again."}
            {/* end of the explanation text */}
            </p>
            {/* link to the existing customer's profile */}
            <Link href={`/dashboard/customers/${state.duplicate.id}`} className="mt-1 inline-block font-medium underline underline-offset-2">
              Open {state.duplicate.name}&apos;s profile
            {/* end of the link */}
            </Link>
          {/* end of the box */}
          </Alert>
          {/* the checkbox only shows for a phone match; an ID match can't be overridden */}
          {state.duplicate.match === "phone" && (
            <CheckboxField className="mt-3" name="shared_phone" label="Yes, this customer shares the number with someone already registered" />
          )}
        {/* end of the full-width row */}
        </div>
      )}

      {/* the submit button row. F1: in the Register popup, Cancel + Register sit on the right */}
      <div className={onCancel ? "flex flex-wrap justify-end gap-2 sm:col-span-2" : "sm:col-span-2"}>
        {/* F1: Cancel (only in the popup). Same height as the main button */}
        {onCancel && (
          <button type="button" onClick={onCancel} className={buttonClasses("secondary")}>
            Cancel
          </button>
        )}
        <SubmitButton
          // F3: "Registering" while it saves (the button is also disabled, so it can't be clicked twice)
          pendingLabel={customer ? "Saving" : "Registering"}
          confirm={
            customer
              ? undefined
              : {
                  title: "Register this customer?",
                  message: "Check the name and ID against the physical ID card.",
                  confirmLabel: "Register",
                  tone: "primary",
                  locked: true,
                }
          }
        >
          {customer ? "Save contact details" : "Register customer"}
        </SubmitButton>
      </div>
      {/* C6: closes the <> opened at the top */}
      </>
      )}
    </ActionForm>
  );
}

/** Item 5: Admin-only correction of locked identity fields. */
// PR4: the current ID shows masked (with the eye to check it), and "New ID number" starts EMPTY.
// Leaving it empty keeps the current number, so the full ID is never put in the page.
export function AdminIdentityForm({ customer }: { customer: Tables<"customers"> }) {
  // same trick as above: keep an old ID type in the dropdown
  const idTypes = !ID_TYPES.includes(customer.id_type) ? [customer.id_type, ...ID_TYPES] : ID_TYPES;
  const [idType, setIdType] = useState(customer.id_type); // the ID type picked (for the format example)
  return (
    // the Admin correction form
    <ActionForm action={adminEditCustomer} className="grid grid-cols-1 gap-3 sm:grid-cols-2" successMessage="Identity corrected. The change is in the audit trail.">
      <input type="hidden" name="customer_id" value={customer.id} />
      {/* #21: when this page loaded the customer; the database refuses the correction if it changed since */}
      <input type="hidden" name="loaded_at" value={customer.updated_at} />
      {/* PR4: what is saved now. customer.id_number is already masked by the page; the eye asks the server for the full number */}
      <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600 sm:col-span-2">
        Current ID: {customer.id_type}{" "}
        <IdReveal customerId={customer.id} masked={customer.id_number} ending={idEnding(customer.id_number)} canReveal />
      {/* end of the current ID line */}
      </p>
      {/* the name, filled in with the current name */}
      <Field label="Full name" name="full_name" defaultValue={customer.full_name} required className="sm:col-span-2" maxLength={MAX.full_name} />
      {/* the ID type, filled in with the current type. onChange updates the format example */}
      <SelectField label="ID type" name="id_type" defaultValue={customer.id_type} required onChange={(e) => setIdType(e.target.value)}>
        {idTypes.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </SelectField>
      {/* PR4: empty on purpose. Blank = keep the current number. The format example follows the chosen type */}
      <Field
        label="New ID number (optional)"
        name="id_number"
        maxLength={MAX.id_number} // F4: length limit
        autoComplete="off"
        hint={`Leave blank to keep the current number.${ID_RULES[idType] ? ` Format: ${ID_RULES[idType].example}.` : ""}`}
      />
      {/* the reason, saved in the audit trail */}
      <TextareaField label="Reason for the change" name="reason" rows={2} required className="sm:col-span-2" hint='At least 5 characters, e.g. "ID number typo, checked the card". Saved in the audit trail.' />
      {/* C10: no variant = navy primary button. justify-self-start = button only as wide as its text, not the whole card */}
      <SubmitButton className="justify-self-start" pendingLabel="Saving" confirm={{ title: "Save this correction?", message: "The before and after values and your reason are written to the audit trail.", confirmLabel: "Save correction", tone: "primary" }}>
        {/* clear label: says exactly what clicking it does, same words as the confirm popup */}
        Save correction
      </SubmitButton>
    {/* end of the Admin correction form */}
    </ActionForm>
  );
}
