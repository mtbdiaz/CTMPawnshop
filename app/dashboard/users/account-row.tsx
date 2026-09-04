"use client";

import { useActionState } from "react";
import { editAccount, resetPassword, type ActionState } from "./actions";
import { ALL_ROLES, ROLE_LABELS } from "@/lib/auth/roles";
import type { Tables } from "@/lib/supabase/database.types";

const initialState: ActionState = {};

export function AccountRow({ account }: { account: Tables<"profiles"> }) {
  const [editState, editFormAction, editPending] = useActionState(editAccount, initialState);
  const [resetState, resetFormAction, resetPending] = useActionState(resetPassword, initialState);

  return (
    <tr className="border-t border-slate-200 align-top">
      <td className="py-2 pr-4">
        <form action={editFormAction} className="flex flex-col gap-1">
          <input type="hidden" name="user_id" value={account.id} />
          <input
            name="full_name"
            defaultValue={account.full_name}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <select
            name="role"
            defaultValue={account.role}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            {ALL_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" name="is_active" defaultChecked={account.is_active} />
            Active
          </label>
          <button
            type="submit"
            disabled={editPending}
            className="mt-1 w-fit rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
          >
            {editPending ? "Saving..." : "Save"}
          </button>
          {editState.error && <p className="text-xs text-red-600">{editState.error}</p>}
        </form>
      </td>
      <td className="py-2 pr-4 align-top">
        <form action={resetFormAction}>
          <input type="hidden" name="user_id" value={account.id} />
          <button
            type="submit"
            disabled={resetPending}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
          >
            {resetPending ? "Resetting..." : "Reset password"}
          </button>
          {resetState.success && resetState.tempPassword && (
            <p className="mt-1 text-xs text-green-700">
              New temp password:{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5">{resetState.tempPassword}</code>
            </p>
          )}
          {resetState.error && <p className="text-xs text-red-600">{resetState.error}</p>}
        </form>
      </td>
    </tr>
  );
}
