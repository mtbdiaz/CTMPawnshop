"use client";

import { useActionState } from "react";
import { resolveSuspiciousFlag, type ActionState } from "./actions";

const initialState: ActionState = {};

export function FlagRow({
  flagId,
  reason,
  customerName,
}: {
  flagId: string;
  reason: string;
  customerName: string;
}) {
  const [state, formAction, pending] = useActionState(resolveSuspiciousFlag, initialState);

  return (
    <tr className="border-t border-slate-200">
      <td className="py-2 pr-4">{customerName}</td>
      <td className="py-2 pr-4">{reason}</td>
      <td className="py-2 pr-4">
        <form action={formAction} className="flex gap-2">
          <input type="hidden" name="flag_id" value={flagId} />
          <button
            type="submit"
            name="decision"
            value="dismissed"
            disabled={pending}
            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
          >
            Dismiss
          </button>
          <button
            type="submit"
            name="decision"
            value="investigating"
            disabled={pending}
            className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            Investigate
          </button>
          <button
            type="submit"
            name="decision"
            value="blacklisted"
            disabled={pending}
            className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800 hover:bg-red-100 disabled:opacity-50"
          >
            Blacklist
          </button>
        </form>
        {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      </td>
    </tr>
  );
}
