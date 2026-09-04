"use client";

import { useActionState, useState } from "react";
import { recordPayment, processExtension, redeemLoan, type ActionState } from "../actions";

const initialState: ActionState = {};

function LostTicketFields() {
  const [show, setShow] = useState(false);
  return (
    <div className="mt-2">
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          name="lost_ticket"
          checked={show}
          onChange={(e) => setShow(e.target.checked)}
        />
        Customer lost their physical ticket — verify by ID instead
      </label>
      {show && (
        <input
          name="id_number_confirm"
          placeholder="Enter customer's ID number on file"
          required
          className="mt-1 w-64 rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      )}
    </div>
  );
}

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
      <LostTicketFields />
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

export function RedeemForm({ loanId, canRedeem }: { loanId: string; canRedeem: boolean }) {
  const [state, formAction, pending] = useActionState(redeemLoan, initialState);

  return (
    <form action={formAction} className="rounded-md border border-green-200 bg-green-50 p-4">
      <input type="hidden" name="loan_id" value={loanId} />
      <p className="text-sm text-green-800">
        {canRedeem
          ? "Balance is fully paid — this item can be redeemed."
          : "Balance must reach ₱0 before redemption."}
      </p>
      <button
        type="submit"
        disabled={pending || !canRedeem}
        className="mt-2 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
      >
        {pending ? "Processing..." : "Redeem item"}
      </button>
      <LostTicketFields />
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      {state.success && <p className="mt-2 text-sm text-green-600">Item redeemed.</p>}
    </form>
  );
}
