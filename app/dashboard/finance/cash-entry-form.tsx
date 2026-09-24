"use client";

import { ActionForm, Field, SelectField, SubmitButton } from "@/components/form";
import { recordCashEntry } from "./actions";

export function CashEntryForm() {
  return (
    <ActionForm
      action={recordCashEntry}
      resetOnSuccess
      successMessage="Entry added to the ledger."
      className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-[10rem_12rem_1fr_auto]"
    >
      <SelectField label="Type" name="entry_type" defaultValue="expense" required>
        <option value="expense">Expense (cash out)</option>
        <option value="revenue">Revenue (cash in)</option>
      </SelectField>
      <Field label="Amount (₱)" name="amount" type="number" step="0.01" min="0.01" required inputMode="decimal" />
      <Field label="Description" name="description" required placeholder="e.g. Electricity bill — September" className="sm:col-span-2 lg:col-span-1" />
      <div className="lg:pt-6">
        <SubmitButton pendingLabel="Saving…">Record entry</SubmitButton>
      </div>
    </ActionForm>
  );
}
