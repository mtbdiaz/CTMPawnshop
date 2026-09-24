"use client";

import { ActionForm, Field, SelectField, SubmitButton } from "@/components/form";
import { Alert } from "@/components/ui";
import { createAccount, type ActionState } from "./actions";
import { ALL_ROLES, ROLE_LABELS } from "@/lib/auth/roles";

export function CreateAccountForm() {
  return (
    <ActionForm action={createAccount} resetOnSuccess successMessage="Staff account created.">
      {(state: ActionState) => (
        <div className="space-y-4">
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_10rem_auto]">
            <Field label="Full name" name="full_name" required autoComplete="off" />
            <Field label="Email" name="email" type="email" required autoComplete="off" hint="Used to sign in." />
            <SelectField label="Role" name="role" defaultValue="operator" required>
              {ALL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </SelectField>
            <div className="lg:pt-6">
              <SubmitButton pendingLabel="Creating…">Add staff account</SubmitButton>
            </div>
          </div>
          {state.success && state.tempPassword && (
            <Alert tone="success" title="Account created — temporary password (shown once)">
              <code className="select-all rounded bg-white px-1.5 py-0.5 font-mono">{state.tempPassword}</code>
              <span className="mt-1 block text-xs">Share it privately. They&apos;ll set their own password on first sign-in.</span>
            </Alert>
          )}
        </div>
      )}
    </ActionForm>
  );
}
