"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Alert, Badge, TD, TR } from "@/components/ui";
import { resetPassword, setStaffActive, updateStaffDetails, type ActionState } from "./actions";
import { ALL_ROLES, ROLE_LABELS } from "@/lib/auth/roles";
import type { Tables } from "@/lib/supabase/database.types";

type Account = Tables<"profiles"> & { email: string | null; loginBlocked: boolean };

// the success text worked out on the server (U5: it can mention a history entry that couldn't be saved)
const serverMessage = (fallback: string) => (state: ActionState) => state.message ?? fallback;

// F4: rounded-md (6px corners) like the other inputs
const inputClass =
  "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20";

export function AccountRow({ account, isSelf }: { account: Account; isSelf: boolean }) {
  return (
    <TR highlight={account.is_active ? undefined : "warning"}>
      <TD>
        {/* U3 (Nov 15): name and role only. Before: this form also sent "active" from when the page was opened, so a Save
            on an old page switched a deactivated account back on. expected_updated_at = the version this page shows. */}
        <ActionForm action={updateStaffDetails} successMessage={serverMessage(`Saved ${account.full_name}.`)} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-center">
          <input type="hidden" name="user_id" value={account.id} />
          <input type="hidden" name="expected_updated_at" value={account.updated_at} />
          <div>
            <label htmlFor={`name-${account.id}`} className="sr-only">
              Full name
            </label>
            <input id={`name-${account.id}`} name="full_name" defaultValue={account.full_name} required className={inputClass} />
            <span className="mt-0.5 block text-xs text-slate-500">
              {account.email ?? ""}
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
            {/* S3: say why the box is greyed out and why there is no Deactivate button on this row */}
            {isSelf && <span className="mt-0.5 block text-xs text-slate-500">You can&apos;t change your own role or deactivate yourself. Ask another Admin.</span>}
          </div>
          <SubmitButton variant="secondary" size="sm" pendingLabel="Saving">
            Save
          </SubmitButton>
        </ActionForm>
      </TD>
      <TD>
        {account.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Deactivated</Badge>}
        {/* U5: the Supabase sign-in step didn't finish last time (the PawnTrack status above is what protects the data) */}
        {!account.is_active && !account.loginBlocked && <span className="mt-1 block text-xs text-amber-800">Sign-in block not finished</span>}
        {account.is_active && account.loginBlocked && <span className="mt-1 block text-xs text-amber-800">Sign-in still blocked</span>}
      </TD>
      <TD>
        <div className="flex flex-wrap items-start gap-2">
          <ActionForm action={resetPassword} showError>
            {(state: ActionState) => (
              <>
                <input type="hidden" name="user_id" value={account.id} />
                <SubmitButton
                  variant="secondary"
                  size="sm"
                  pendingLabel="Resetting"
                  confirm={{
                    title: `Reset ${account.full_name}'s password?`,
                    message: "Their current password stops working immediately. You'll get a temporary password to share with them.",
                    confirmLabel: "Reset password",
                    tone: "primary",
                  }}
                >
                  Reset password
                </SubmitButton>
                {state.success && state.message && <span className="mt-1 block text-xs text-amber-800">{state.message}</span>}
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
            // U3 + U5: only the status and the sign-in block change (name and role stay as they are now). "Finish ..."
            // appears when the sign-in step failed last time; the same action completes it.
            <ActionForm action={setStaffActive} successMessage={serverMessage(account.is_active ? `${account.full_name} deactivated.` : `${account.full_name} reactivated.`)}>
              <input type="hidden" name="user_id" value={account.id} />
              <input type="hidden" name="expected_updated_at" value={account.updated_at} />
              {/* sign-in blocked now = the button switches the account on (Reactivate, or Finish reactivation);
                  not blocked = it switches it off (Deactivate, or Finish deactivation) */}
              {account.loginBlocked && <input type="hidden" name="make_active" value="on" />}
              {account.is_active && !account.loginBlocked ? (
                <SubmitButton
                  variant="danger"
                  size="sm"
                  pendingLabel="Deactivating"
                  confirm={{
                    title: `Deactivate ${account.full_name}?`,
                    message: "They'll be signed out and blocked from logging in until an Admin reactivates the account.",
                    confirmLabel: "Deactivate account",
                  }}
                >
                  Deactivate
                </SubmitButton>
              ) : account.is_active && account.loginBlocked ? (
                <SubmitButton variant="secondary" size="sm" pendingLabel="Finishing">
                  Finish reactivation
                </SubmitButton>
              ) : !account.loginBlocked ? (
                <SubmitButton variant="danger" size="sm" pendingLabel="Finishing">
                  Finish deactivation
                </SubmitButton>
              ) : (
                <SubmitButton variant="secondary" size="sm" pendingLabel="Reactivating">
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
