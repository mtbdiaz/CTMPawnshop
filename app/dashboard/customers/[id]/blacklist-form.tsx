"use client";

import { useActionState } from "react";
import { setBlacklistStatus, type ActionState } from "../actions";
import type { Tables } from "@/lib/supabase/database.types";

const initialState: ActionState = {};

export function BlacklistForm({ customer }: { customer: Tables<"customers"> }) {
  const [state, formAction, pending] = useActionState(setBlacklistStatus, initialState);

  return (
    <form action={formAction} className="mt-2 space-y-2 rounded-md border border-slate-200 bg-white p-4">
      <input type="hidden" name="customer_id" value={customer.id} />
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="is_blacklisted" defaultChecked={customer.is_blacklisted} />
        Blacklisted
      </label>
      <input
        name="blacklist_reason"
        defaultValue={customer.blacklist_reason ?? ""}
        placeholder="Reason (required to blacklist)"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Update blacklist status"}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
