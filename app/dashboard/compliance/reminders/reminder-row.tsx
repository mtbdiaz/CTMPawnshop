"use client";

import { useActionState } from "react";
import { sendReminder, type ActionState } from "../actions";

const initialState: ActionState = {};

export function ReminderRow({
  loanId,
  customerName,
  maturityDate,
  alreadySent,
}: {
  loanId: string;
  customerName: string;
  maturityDate: string;
  alreadySent: boolean;
}) {
  const [state, formAction, pending] = useActionState(sendReminder, initialState);

  return (
    <tr className="border-t border-slate-200">
      <td className="py-2 pr-4">{customerName}</td>
      <td className="py-2 pr-4">{maturityDate}</td>
      <td className="py-2 pr-4">
        {alreadySent || state.success ? (
          <span className="text-xs text-green-700">Reminder sent</span>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="loan_id" value={loanId} />
            <button
              type="submit"
              disabled={pending}
              className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
            >
              {pending ? "Sending..." : "Send reminder"}
            </button>
          </form>
        )}
        {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      </td>
    </tr>
  );
}
