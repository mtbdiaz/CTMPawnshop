"use client";

import { useActionState } from "react";
import { createAuctionBatch, type ActionState } from "../actions";

const initialState: ActionState = {};

export function AuctionForm({ items }: { items: { id: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState(createAuctionBatch, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="item_id" value={item.id} />
            {item.label}
          </label>
        ))}
      </div>
      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-slate-700">
          Batch notes
        </label>
        <input
          id="notes"
          name="notes"
          className="mt-1 w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.success && <p className="text-sm text-green-600">Auction batch created.</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Creating..." : "Create auction batch"}
      </button>
    </form>
  );
}
