"use client";

import { useActionState } from "react";
import { resolveCounterfeitFlag, type ActionState } from "../actions";

const initialState: ActionState = {};

export function ResolveForm({ appraisalId }: { appraisalId: string }) {
  const [state, formAction, pending] = useActionState(resolveCounterfeitFlag, initialState);

  return (
    <form action={formAction} className="mt-2 flex items-center gap-2">
      <input type="hidden" name="appraisal_id" value={appraisalId} />
      <button
        type="submit"
        name="decision"
        value="cleared"
        disabled={pending}
        className="rounded-md border border-green-300 bg-green-50 px-3 py-1.5 text-sm text-green-800 hover:bg-green-100 disabled:opacity-50"
      >
        Clear flag (false alarm)
      </button>
      <button
        type="submit"
        name="decision"
        value="confirmed"
        disabled={pending}
        className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm text-red-800 hover:bg-red-100 disabled:opacity-50"
      >
        Confirm risk (stop transaction)
      </button>
      {state.error && <span className="text-sm text-red-600">{state.error}</span>}
    </form>
  );
}
