"use client";

import { ActionForm, Field, SubmitButton } from "@/components/form";
import { updateBusinessRules } from "./actions";
import type { Tables } from "@/lib/supabase/database.types";

export function SettingsForm({ settings }: { settings: Tables<"system_settings"> }) {
  return (
    <ActionForm action={updateBusinessRules} successMessage="Business rules saved — new appraisals and loans use these values." className="grid max-w-2xl grid-cols-1 gap-5 sm:grid-cols-2">
      <Field
        name="gold_price_per_gram"
        label="Gold price per gram (₱)"
        type="number"
        step="0.01"
        min="0"
        required
        defaultValue={settings.gold_price_per_gram}
        hint="24k reference price. Update daily."
      />
      <Field
        name="interest_rate_percent"
        label="Interest rate (% per 30-day term)"
        type="number"
        step="0.01"
        min="0"
        required
        defaultValue={settings.interest_rate_percent}
        hint="Locked in on each new loan at issue time."
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
        hint="Maximum loan as a share of appraised value."
      />
      <Field
        name="grace_period_days"
        label="Grace period (days)"
        type="number"
        step="1"
        min="0"
        required
        defaultValue={settings.grace_period_days}
        hint="Days after maturity before an unpaid loan defaults."
      />
      <div className="sm:col-span-2">
        <SubmitButton
          pendingLabel="Saving…"
          confirm={{
            title: "Save new business rules?",
            message: "These values apply to every new appraisal, loan and renewal from now on. Existing loans keep the rate they were issued with.",
            confirmLabel: "Save settings",
            tone: "primary",
          }}
        >
          Save settings
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
