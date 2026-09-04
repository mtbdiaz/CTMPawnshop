"use client";

import { useActionState } from "react";
import { recordCashEntry, type ActionState } from "./actions";

const initialState: ActionState = {};

export function CashEntryForm() {
  const [state, formAction, pending] = useActionState(recordCashEntry, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-white p-4">
      <div>
        <label htmlFor="entry_type" className="block text-xs font-medium text-slate-700">
          Type
        </label>
        <select
          id="entry_type"
          name="entry_type"
          className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="expense">Expense</option>
          <option value="revenue">Revenue</option>
        </select>
      </div>
      <div>
        <label htmlFor="amount" className="block text-xs font-medium text-slate-700">
          Amount (₱)
        </label>
        <input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          required
          className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex-1">
        <label htmlFor="description" className="block text-xs font-medium text-slate-700">
          Description
        </label>
        <input
          id="description"
          name="description"
          required
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Record entry"}
      </button>
      {state.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
      {state.success && <p className="w-full text-sm text-green-600">Entry recorded.</p>}
    </form>
  );
}
