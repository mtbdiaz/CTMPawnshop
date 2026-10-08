"use client";

import { useRouter } from "next/navigation";
import { ActionForm, Field, SelectField, SubmitButton, TextareaField } from "@/components/form";
import { adminEditCustomer, type ActionState } from "./actions";
import type { Tables } from "@/lib/supabase/database.types";

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
];

export function CustomerForm({
  action,
  customer,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  customer?: Tables<"customers">;
}) {
  const router = useRouter();
  const idTypes = customer && !ID_TYPES.includes(customer.id_type) ? [customer.id_type, ...ID_TYPES] : ID_TYPES;

  return (
    <ActionForm
      action={action}
      className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2"
      successMessage={customer ? "Customer profile saved." : "Customer registered. AML check completed."}
      onSuccess={(state) => {
        if (!customer && state.customerId) router.push(`/dashboard/customers/${state.customerId}`);
      }}
    >
      {customer && <input type="hidden" name="customer_id" value={customer.id} />}

      {customer ? (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600 sm:col-span-2">
          Name and ID are locked after registration: <span className="font-medium text-slate-900">{customer.full_name}</span>, {customer.id_type}{" "}
          <span className="font-mono">{customer.id_number}</span>. Only an Admin can correct them.
        </p>
      ) : (
        <Field label="Full name" name="full_name" required autoComplete="off" />
      )}
      <Field
        label="Contact number"
        name="contact_number"
        type="tel"
        defaultValue={customer?.contact_number}
        required
        placeholder="09XX XXX XXXX"
      />
      <Field label="Email" name="email" type="email" defaultValue={customer?.email ?? ""} hint="Optional" className="sm:col-span-2" />
      <Field label="Address" name="address" defaultValue={customer?.address} required className="sm:col-span-2" />
      <Field label="Date of birth" name="date_of_birth" type="date" defaultValue={customer?.date_of_birth ?? ""} hint="Optional" />
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
    </ActionForm>
  );
}

/** Item 5: Admin-only correction of locked identity fields. */
export function AdminIdentityForm({ customer }: { customer: Tables<"customers"> }) {
  const idTypes = !ID_TYPES.includes(customer.id_type) ? [customer.id_type, ...ID_TYPES] : ID_TYPES;
  return (
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
      <SubmitButton variant="secondary" pendingLabel="Saving" confirm={{ title: "Save this correction?", message: "The before and after values and your reason are written to the audit trail.", confirmLabel: "Save correction", tone: "primary" }}>
        Edit (Admin)
      </SubmitButton>
    </ActionForm>
  );
}
