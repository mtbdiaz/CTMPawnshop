"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, TD, TR } from "@/components/ui";
import { editAccount, resetPassword, type ActionState } from "./actions";
import { ALL_ROLES, ROLE_LABELS } from "@/lib/auth/roles";
import type { Tables } from "@/lib/supabase/database.types";

type Account = Tables<"profiles"> & { email: string | null };

const inputClass =
  "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20";

export function AccountRow({ account, isSelf }: { account: Account; isSelf: boolean }) {
  return (
    <TR highlight={account.is_active ? undefined : "warning"}>
      <TD>
        <ActionForm action={editAccount} successMessage={`Saved ${account.full_name}.`} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-center">
          <input type="hidden" name="user_id" value={account.id} />
          {account.is_active && <input type="hidden" name="is_active" value="on" />}
          <div>
            <label htmlFor={`name-${account.id}`} className="sr-only">
              Full name
            </label>
            <input id={`name-${account.id}`} name="full_name" defaultValue={account.full_name} required className={inputClass} />
            <span className="mt-0.5 block text-xs text-slate-500">
              {account.email ?? "—"}
              {isSelf && " · you"}
            </span>
          </div>
          <div>
            <label htmlFor={`role-${account.id}`} className="sr-only">
              Role
            </label>
            <select id={`role-${account.id}`} name="role" defaultValue={account.role} disabled={isSelf} className={inputClass}>
              {ALL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
            {isSelf && <input type="hidden" name="role" value={account.role} />}
          </div>
          <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">
            Save
          </SubmitButton>
        </ActionForm>
      </TD>
      <TD>{account.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Deactivated</Badge>}</TD>
      <TD>
        <div className="flex flex-wrap items-start gap-2">
          <ActionForm action={resetPassword} showError>
            {(state: ActionState) => (
              <>
                <input type="hidden" name="user_id" value={account.id} />
                <SubmitButton
                  variant="secondary"
                  size="sm"
                  pendingLabel="Resetting…"
                  confirm={{
                    title: `Reset ${account.full_name}'s password?`,
                    message: "Their current password stops working immediately. You'll get a temporary password to share with them.",
                    confirmLabel: "Reset password",
                    tone: "primary",
                  }}
                >
                  Reset password
                </SubmitButton>
                {state.success && state.tempPassword && (
                  <Alert tone="success" className="mt-2" title="Temporary password (shown once)">
                    <code className="select-all rounded bg-white px-1.5 py-0.5 font-mono">{state.tempPassword}</code>
                    <span className="mt-1 block text-xs">They&apos;ll be asked to set a new password on next sign-in.</span>
                  </Alert>
                )}
              </>
            )}
          </ActionForm>
          {!isSelf && (
            <ActionForm action={editAccount} successMessage={account.is_active ? `${account.full_name} deactivated.` : `${account.full_name} reactivated.`}>
              <input type="hidden" name="user_id" value={account.id} />
              <input type="hidden" name="full_name" value={account.full_name} />
              <input type="hidden" name="role" value={account.role} />
              {!account.is_active && <input type="hidden" name="is_active" value="on" />}
              {account.is_active ? (
                <SubmitButton
                  variant="danger"
                  size="sm"
                  pendingLabel="Deactivating…"
                  confirm={{
                    title: `Deactivate ${account.full_name}?`,
                    message: "They'll be signed out and blocked from logging in until an Admin reactivates the account.",
                    confirmLabel: "Deactivate account",
                  }}
                >
                  Deactivate
                </SubmitButton>
              ) : (
                <SubmitButton variant="secondary" size="sm" pendingLabel="Reactivating…">
                  Reactivate
                </SubmitButton>
              )}
            </ActionForm>
          )}
        </div>
      </TD>
    </TR>
  );
}
