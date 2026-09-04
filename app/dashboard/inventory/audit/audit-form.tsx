"use client";

import { useActionState } from "react";
import { submitAudit, type ActionState } from "../actions";

const initialState: ActionState = {};

type Item = {
  id: string;
  status: string;
  vault_location: string;
  label: string;
};

export function AuditForm({ items }: { items: Item[] }) {
  const [state, formAction, pending] = useActionState(submitAudit, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase text-slate-500">
            <th className="pb-2 pr-4">Item</th>
            <th className="pb-2 pr-4">Vault location</th>
            <th className="pb-2 pr-4">System status</th>
            <th className="pb-2 pr-4">Found in vault?</th>
            <th className="pb-2 pr-4">Notes</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-slate-200">
              <td className="py-2 pr-4">{item.label}</td>
              <td className="py-2 pr-4">{item.vault_location}</td>
              <td className="py-2 pr-4">{item.status}</td>
              <td className="py-2 pr-4">
                <input type="hidden" name="item_id" value={item.id} />
                <input type="hidden" name="expected_status" value={item.status} />
                <input type="checkbox" name={`found_${item.id}`} defaultChecked />
              </td>
              <td className="py-2 pr-4">
                <input
                  name={`notes_${item.id}`}
                  placeholder="Discrepancy notes"
                  className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-slate-700">
          Overall audit notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          className="mt-1 w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.success && <p className="text-sm text-green-600">Audit recorded.</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Submit audit"}
      </button>
    </form>
  );
}
