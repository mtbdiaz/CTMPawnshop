"use client";

import { useActionState, useMemo, useState } from "react";
import { createLoan, type ActionState } from "./actions";

const initialState: ActionState = {};

type AvailableItem = {
  id: string;
  customer_id: string;
  customer_name: string;
  weight_grams: number;
  karat: number;
  suggested_loan_max: number;
};

export function NewLoanForm({ items }: { items: AvailableItem[] }) {
  const [state, formAction, pending] = useActionState(createLoan, initialState);
  const [selectedId, setSelectedId] = useState("");

  const selected = useMemo(() => items.find((i) => i.id === selectedId), [items, selectedId]);

  return (
    <form action={formAction} className="grid max-w-xl grid-cols-2 gap-4">
      <div className="col-span-2">
        <label htmlFor="appraisal_item_id" className="block text-sm font-medium text-slate-700">
          Appraised item
        </label>
        <select
          id="appraisal_item_id"
          name="appraisal_item_id"
          required
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Select an appraised, available item...</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.customer_name} — {item.weight_grams}g {item.karat}k (suggested max ₱
              {item.suggested_loan_max.toLocaleString()})
            </option>
          ))}
        </select>
      </div>

      <input type="hidden" name="customer_id" value={selected?.customer_id ?? ""} />

      <div>
        <label htmlFor="principal_amount" className="block text-sm font-medium text-slate-700">
          Loan amount (₱)
        </label>
        <input
          id="principal_amount"
          name="principal_amount"
          type="number"
          step="0.01"
          required
          defaultValue={selected?.suggested_loan_max}
          key={selected?.id}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="vault_location" className="block text-sm font-medium text-slate-700">
          Vault location
        </label>
        <input
          id="vault_location"
          name="vault_location"
          required
          placeholder="e.g. Vault A - Shelf 3"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {state.error && (
        <p role="alert" className="col-span-2 text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="col-span-2 text-sm text-green-600">Loan created and ticket issued.</p>
      )}

      <div className="col-span-2">
        <button
          type="submit"
          disabled={pending || !selectedId}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? "Creating..." : "Create loan & issue ticket"}
        </button>
      </div>
    </form>
  );
}
