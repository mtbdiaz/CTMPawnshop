"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, Field, SelectField, SubmitButton } from "@/components/form";
import { formatPeso } from "@/lib/format";
import { createLoan, type ActionState } from "./actions";

type AvailableItem = {
  id: string;
  customer_id: string;
  customer_name: string;
  weight_grams: number;
  karat: number;
  suggested_loan_min: number;
  suggested_loan_max: number;
};

export function NewLoanForm({
  items,
  defaultItemId,
  interestRatePercent,
}: {
  items: AvailableItem[];
  defaultItemId?: string;
  interestRatePercent: number;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(items.some((i) => i.id === defaultItemId) ? defaultItemId! : "");
  const selected = useMemo(() => items.find((i) => i.id === selectedId), [items, selectedId]);
  const [amount, setAmount] = useState(selected ? String(selected.suggested_loan_max) : "");

  const principal = Number(amount);
  const interest = principal > 0 ? Math.round(principal * interestRatePercent) / 100 : 0;

  return (
    <ActionForm
      action={createLoan}
      className="grid grid-cols-1 gap-4 lg:grid-cols-3"
      successMessage="Loan created — pawn ticket issued."
      onSuccess={(state: ActionState) => {
        if (state.id) router.push(`/dashboard/loans/${state.id}?issued=1`);
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
        <SelectField
          label="Appraised item"
          name="appraisal_item_id"
          required
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            const item = items.find((i) => i.id === e.target.value);
            setAmount(item ? String(item.suggested_loan_max) : "");
          }}
          className="sm:col-span-2"
          hint={items.length === 0 ? "No appraised items are available — appraise an item first." : "Only unflagged items without an open loan are listed."}
        >
          <option value="" disabled>
            Select an item…
          </option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.customer_name} — {item.weight_grams}g {item.karat}k (max {formatPeso(item.suggested_loan_max)})
            </option>
          ))}
        </SelectField>

        <input type="hidden" name="customer_id" value={selected?.customer_id ?? ""} />

        <Field
          label="Loan amount (₱)"
          name="principal_amount"
          type="number"
          step="0.01"
          min="1"
          max={selected?.suggested_loan_max}
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          hint={selected ? `Suggested ${formatPeso(selected.suggested_loan_min)} – ${formatPeso(selected.suggested_loan_max)}` : undefined}
        />
        <Field label="Vault location" name="vault_location" required placeholder="e.g. Vault A · Shelf 3 · Box 12" />
      </div>

      <aside className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm lg:self-start">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ticket summary</p>
        <dl className="mt-3 space-y-2">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-600">Customer</dt>
            <dd className="text-right font-medium">{selected?.customer_name ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-600">Principal</dt>
            <dd className="tabular-nums font-medium">{formatPeso(principal)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-600">Interest ({interestRatePercent}%/30 days)</dt>
            <dd className="tabular-nums font-medium">{formatPeso(interest)}</dd>
          </div>
          <div className="flex justify-between gap-2 border-t border-slate-200 pt-2">
            <dt className="font-semibold text-slate-900">To redeem at maturity</dt>
            <dd className="tabular-nums font-semibold text-navy-900">{formatPeso(principal + interest)}</dd>
          </div>
        </dl>
      </aside>

      <div className="lg:col-span-3">
        <SubmitButton pendingLabel="Creating loan…" disabled={!selectedId}>
          Create loan &amp; issue ticket
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
