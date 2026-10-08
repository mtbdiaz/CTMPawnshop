"use client";

import { ActionForm, Field, SubmitButton } from "@/components/form";
import { formatPeso } from "@/lib/format";
import { updateBusinessRules } from "./actions";
import type { Tables } from "@/lib/supabase/database.types";

export function SettingsForm({ settings }: { settings: Tables<"system_settings"> }) {
  return (
    <ActionForm
      action={updateBusinessRules}
      successMessage="Rates saved. New appraisals and loans use these values."
      className="grid max-w-3xl grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 sm:col-span-3">Gold price per gram</p>
      <Field name="price_24k" label="24K (₱/g)" type="number" step="0.01" min="0.01" required defaultValue={settings.price_24k} inputMode="decimal" />
      <Field name="price_21k" label="21K (₱/g)" type="number" step="0.01" min="0.01" required defaultValue={settings.price_21k} inputMode="decimal" />
      <Field name="price_18k" label="18K (₱/g)" type="number" step="0.01" min="0.01" required defaultValue={settings.price_18k} inputMode="decimal" />
      <p className="text-xs text-slate-500 sm:col-span-3">
        Item value = weight in grams x the price for its karat. Items below 18K are not accepted.
      </p>

      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:col-span-3">Loan terms</p>
      <Field
        name="interest_rate_percent"
        label="Interest (% per 30 days)"
        type="number"
        step="0.01"
        min="0"
        required
        defaultValue={settings.interest_rate_percent}
        hint="Fixed on each loan when it is issued."
      />
      <Field
        name="ltv_percent"
        label="Loan-to-value (%)"
        type="number"
        step="0.01"
        min="0.01"
        max="100"
        required
        defaultValue={settings.ltv_percent}
        hint="Maximum loan as a share of item value."
      />
      <Field
        name="grace_period_days"
        label="Grace period (days)"
        type="number"
        step="1"
        min="0"
        required
        defaultValue={settings.grace_period_days}
        hint="Days after maturity before default."
      />
      <div className="sm:col-span-3">
        <SubmitButton
          pendingLabel="Saving"
          confirm={{
            title: "Save new rates?",
            message: "These values apply to every new appraisal, loan and renewal from now on. Existing loans keep their rate.",
            confirmLabel: "Save rates",
            tone: "primary",
            details: [
              ["Current 24K", formatPeso(settings.price_24k)],
              ["Current 21K", formatPeso(settings.price_21k)],
              ["Current 18K", formatPeso(settings.price_18k)],
            ],
          }}
        >
          Save rates
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
