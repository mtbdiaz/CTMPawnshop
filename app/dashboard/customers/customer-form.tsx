"use client";

import { useRouter } from "next/navigation";
import { ActionForm, Field, SelectField, SubmitButton } from "@/components/form";
import type { ActionState } from "./actions";
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
      successMessage={customer ? "Customer profile saved." : "Customer registered — AML check completed."}
      onSuccess={(state) => {
        if (!customer && state.customerId) router.push(`/dashboard/customers/${state.customerId}`);
      }}
    >
      {customer && <input type="hidden" name="customer_id" value={customer.id} />}

      <Field label="Full name" name="full_name" defaultValue={customer?.full_name} required autoComplete="off" />
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
      <SelectField label="Valid ID type" name="id_type" defaultValue={customer?.id_type ?? ""} required>
        <option value="" disabled>
          Select an ID type…
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
        defaultValue={customer?.id_number}
        required
        className="sm:col-span-2"
        hint="Used to verify identity if the customer loses their pawn ticket."
      />

      <div className="sm:col-span-2">
        <SubmitButton pendingLabel="Saving…">{customer ? "Save changes" : "Register customer"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
