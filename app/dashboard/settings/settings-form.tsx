"use client";

import { useActionState } from "react";
import { updateBusinessRules, type SettingsFormState } from "./actions";
import type { Tables } from "@/lib/supabase/database.types";

const initialState: SettingsFormState = {};

export function SettingsForm({ settings }: { settings: Tables<"system_settings"> }) {
  const [state, formAction, pending] = useActionState(updateBusinessRules, initialState);

  return (
    <form action={formAction} className="mt-6 max-w-md space-y-4">
      <Field
        name="interest_rate_percent"
        label="Monthly interest rate (%)"
        defaultValue={settings.interest_rate_percent}
      />
      <Field
        name="gold_price_per_gram"
        label="Gold price per gram (PHP)"
        defaultValue={settings.gold_price_per_gram}
      />
      <Field
        name="ltv_percent"
        label="Loan-to-value (%)"
        defaultValue={settings.ltv_percent}
      />
      <Field
        name="grace_period_days"
        label="Grace period (days)"
        defaultValue={settings.grace_period_days}
        step="1"
      />

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.success && <p className="text-sm text-green-600">Saved.</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save settings"}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  defaultValue,
  step = "0.01",
}: {
  name: string;
  label: string;
  defaultValue: number;
  step?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="number"
        step={step}
        defaultValue={defaultValue}
        required
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
      />
    </div>
  );
}
