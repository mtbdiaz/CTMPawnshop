"use client";

import { ActionForm, Field, SelectField, SubmitButton, TextareaField } from "@/components/form";
import { ITEM_CATEGORIES, KARATS } from "@/lib/appraisal/valuation";
import { updateAppraisal } from "../actions";

/** Editable only while the item is still in the available pool. */
export function EditAppraisalForm({
  id,
  category,
  categoryOther,
  karat,
  weight,
  notes,
}: {
  id: string;
  category: string;
  categoryOther: string | null;
  karat: number;
  weight: number;
  notes: string | null;
}) {
  return (
    <ActionForm action={updateAppraisal} className="grid grid-cols-1 gap-3 sm:grid-cols-2" successMessage="Appraisal updated. Value recalculated at today's prices.">
      <input type="hidden" name="appraisal_id" value={id} />
      <SelectField label="Category" name="category" defaultValue={category} required>
        {ITEM_CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </SelectField>
      <Field label="If Others, describe" name="category_other" defaultValue={categoryOther ?? ""} hint="Optional" />
      <SelectField label="Karat" name="karat" defaultValue={String(KARATS.includes(karat as (typeof KARATS)[number]) ? karat : "")} required>
        <option value="">Choose</option>
        {KARATS.map((k) => (
          <option key={k} value={k}>
            {k}K
          </option>
        ))}
      </SelectField>
      <Field label="Weight (g)" name="weight_grams" type="number" step="0.001" min="0.001" defaultValue={weight} required />
      <TextareaField label="Notes" name="condition_notes" rows={2} defaultValue={notes ?? ""} className="sm:col-span-2" />
      <div className="sm:col-span-2">
        <SubmitButton variant="secondary" pendingLabel="Saving">
          Save changes
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
