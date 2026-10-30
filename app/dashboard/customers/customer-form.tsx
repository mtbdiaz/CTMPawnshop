"use client"; // this file runs in the browser (it uses buttons, router, form state)

import Link from "next/link"; // C6: for the "Open their profile" link
import { useRouter } from "next/navigation"; // lets us go to another page after saving
import { ActionForm, CheckboxField, Field, SelectField, SubmitButton, TextareaField } from "@/components/form"; // shared form parts (C6: added CheckboxField)
import { Alert } from "@/components/ui"; // C6: the red/yellow message box
import { adminEditCustomer, type ActionState } from "./actions"; // server actions + the result type
import type { Tables } from "@/lib/supabase/database.types"; // the customer row type from the database

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
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>; // type of the action
  customer?: Tables<"customers">; // type of the customer (optional)
}) {
  const router = useRouter(); // used to open the new profile after registering
  // if the customer has an old ID type not in the list, add it so the dropdown can still show it
  const idTypes = customer && !ID_TYPES.includes(customer.id_type) ? [customer.id_type, ...ID_TYPES] : ID_TYPES;

  return (
    // the form wrapper: handles submit, errors, the confirm popup and the success message
    <ActionForm
      action={action}
      className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2"
      successMessage={customer ? "Customer profile saved." : "Customer registered. AML check completed."}
      onSuccess={(state) => {
        // after registering, go straight to the new customer's profile
        if (!customer && state.customerId) router.push(`/dashboard/customers/${state.customerId}`);
      }}
    >
      {(state) => ( // C6: "state" = what the server sent back, so we can show who the duplicate is
      <>
      {/* hidden customer id, only when editing */}
      {customer && <input type="hidden" name="customer_id" value={customer.id} />}

      {/* when editing: show the locked name and ID. when registering: show the Full name field */}
      {customer ? (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600 sm:col-span-2">
          Name and ID are locked after registration: <span className="font-medium text-slate-900">{customer.full_name}</span>, {customer.id_type}{" "}
          <span className="font-mono">{customer.id_number}</span>. Only an Admin can correct them.
        </p>
      ) : (
        <Field label="Full name" name="full_name" required autoComplete="off" />
      )}
      {/* phone number field */}
      <Field
        label="Contact number"
        name="contact_number"
        type="tel"
        defaultValue={customer?.contact_number}
        required
        placeholder="09XX XXX XXXX"
      />
      {/* email, address and birthday fields */}
      <Field label="Email" name="email" type="email" defaultValue={customer?.email ?? ""} hint="Optional" className="sm:col-span-2" />
      <Field label="Address" name="address" defaultValue={customer?.address} required className="sm:col-span-2" />
      <Field label="Date of birth" name="date_of_birth" type="date" defaultValue={customer?.date_of_birth ?? ""} hint="Optional" />
      {/* ID type and ID number, only when registering (locked after) */}
      {!customer && (
        <>
          <SelectField label="Valid ID type" name="id_type" defaultValue="" required>
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
            required
            className="sm:col-span-2"
            hint="Used to verify identity if the customer loses their pawn ticket. Locked after registration."
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

      {/* the submit button row */}
      <div className="sm:col-span-2">
        <SubmitButton
          pendingLabel="Saving"
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
export function AdminIdentityForm({ customer }: { customer: Tables<"customers"> }) {
  // same trick as above: keep an old ID type in the dropdown
  const idTypes = !ID_TYPES.includes(customer.id_type) ? [customer.id_type, ...ID_TYPES] : ID_TYPES;
  return (
    // the Admin correction form
    <ActionForm action={adminEditCustomer} className="grid grid-cols-1 gap-3" successMessage="Identity corrected. The change is in the audit trail.">
      <input type="hidden" name="customer_id" value={customer.id} />
      <Field label="Full name" name="full_name" defaultValue={customer.full_name} required />
      <SelectField label="ID type" name="id_type" defaultValue={customer.id_type} required>
        {idTypes.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </SelectField>
      <Field label="ID number" name="id_number" defaultValue={customer.id_number} required />
      <TextareaField label="Reason for the change" name="reason" rows={2} required hint="At least 5 characters. Saved in the audit trail." />
      {/* C10: no variant = navy primary button. justify-self-start = button only as wide as its text, not the whole card */}
      <SubmitButton className="justify-self-start" pendingLabel="Saving" confirm={{ title: "Save this correction?", message: "The before and after values and your reason are written to the audit trail.", confirmLabel: "Save correction", tone: "primary" }}>
        {/* clear label: says exactly what clicking it does, same words as the confirm popup */}
        Save correction
      </SubmitButton>
    </ActionForm>
  );
}