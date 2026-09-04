"use client";

import { useActionState } from "react";
import type { ActionState } from "./actions";
import type { Tables } from "@/lib/supabase/database.types";

const initialState: ActionState = {};

export function CustomerForm({
  action,
  customer,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  customer?: Tables<"customers">;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="grid max-w-2xl grid-cols-2 gap-4">
      {customer && <input type="hidden" name="customer_id" value={customer.id} />}

      <Field label="Full name" name="full_name" defaultValue={customer?.full_name} required />
      <Field label="Contact number" name="contact_number" defaultValue={customer?.contact_number} required />
      <Field label="Email (optional)" name="email" type="email" defaultValue={customer?.email ?? ""} className="col-span-2" />
      <Field label="Address" name="address" defaultValue={customer?.address} required className="col-span-2" />
      <Field label="Date of birth" name="date_of_birth" type="date" defaultValue={customer?.date_of_birth ?? ""} />
      <Field label="ID type" name="id_type" defaultValue={customer?.id_type} required placeholder="e.g. Passport, UMID, Driver's License" />
      <Field label="ID number" name="id_number" defaultValue={customer?.id_number} required className="col-span-2" />

      {state.error && (
        <p role="alert" className="col-span-2 text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.success && <p className="col-span-2 text-sm text-green-600">Saved.</p>}

      <div className="col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? "Saving..." : customer ? "Save changes" : "Register customer"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required = false,
  className = "",
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  type?: string;
  required?: boolean;
  className?: string;
  placeholder?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={name} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue ?? ""}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
      />
    </div>
  );
}
