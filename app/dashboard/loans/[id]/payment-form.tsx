"use client";

import { useActionState } from "react";
import { recordPayment, processExtension, type ActionState } from "../actions";

const initialState: ActionState = {};

export function PaymentForm({ loanId, interestDue }: { loanId: string; interestDue: number }) {
  const [state, formAction, pending] = useActionState(recordPayment, initialState);

  return (
    <form action={formAction} className="rounded-md border border-slate-200 bg-white p-4">
      <input type="hidden" name="loan_id" value={loanId} />
      <label htmlFor="amount" className="block text-sm font-medium text-slate-700">
        Payment amount (₱) — interest due this period: ₱{interestDue.toLocaleString()}
      </label>
      <input
        id="amount"
        name="amount"
        type="number"
        step="0.01"
        required
        className="mt-1 w-48 rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="ml-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Recording..." : "Record payment"}
      </button>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      {state.success && <p className="mt-2 text-sm text-green-600">Payment recorded.</p>}
    </form>
  );
}

export function ExtensionForm({ loanId }: { loanId: string }) {
  const [state, formAction, pending] = useActionState(processExtension, initialState);

  return (
    <form action={formAction} className="rounded-md border border-slate-200 bg-white p-4">
      <input type="hidden" name="loan_id" value={loanId} />
      <p className="text-sm text-slate-600">
        Extend this loan by one term (recalculates maturity date, charges one additional interest
        period).
      </p>
      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 disabled:opacity-50"
      >
        {pending ? "Processing..." : "Extend loan"}
      </button>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      {state.success && <p className="mt-2 text-sm text-green-600">Loan extended.</p>}
    </form>
  );
}
