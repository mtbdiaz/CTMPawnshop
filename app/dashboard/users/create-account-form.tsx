"use client";

import { useActionState } from "react";
import { createAccount, type ActionState } from "./actions";
import { ALL_ROLES, ROLE_LABELS } from "@/lib/auth/roles";

const initialState: ActionState = {};

export function CreateAccountForm() {
  const [state, formAction, pending] = useActionState(createAccount, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-white p-4">
      <div>
        <label htmlFor="full_name" className="block text-xs font-medium text-slate-700">
          Full name
        </label>
        <input
          id="full_name"
          name="full_name"
          required
          className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label htmlFor="email" className="block text-xs font-medium text-slate-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label htmlFor="role" className="block text-xs font-medium text-slate-700">
          Role
        </label>
        <select
          id="role"
          name="role"
          defaultValue="operator"
          className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          {ALL_ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Creating..." : "Add staff account"}
      </button>

      {state.error && (
        <p role="alert" className="w-full text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state.success && state.tempPassword && (
        <p className="w-full text-sm text-green-700">
          Account created. Temporary password (share securely, shown once):{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5">{state.tempPassword}</code>
        </p>
      )}
    </form>
  );
}
