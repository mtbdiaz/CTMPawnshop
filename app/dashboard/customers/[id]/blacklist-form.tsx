"use client";

import { ActionForm, Field, SubmitButton } from "@/components/form";
import { setBlacklistStatus } from "../actions";
import type { Tables } from "@/lib/supabase/database.types";

export function BlacklistForm({ customer }: { customer: Tables<"customers"> }) {
  if (customer.is_blacklisted) {
    return (
      <ActionForm action={setBlacklistStatus} successMessage="Customer removed from the blacklist." className="space-y-3">
        <input type="hidden" name="customer_id" value={customer.id} />
        <p className="text-sm text-slate-600">
          Removing the flag lets this customer receive new appraisals and loans again.
        </p>
        <SubmitButton
          variant="secondary"
          pendingLabel="Updating…"
          confirm={{
            title: "Remove from blacklist?",
            message: `${customer.full_name} will be able to transact again. This change is recorded in the audit trail.`,
            confirmLabel: "Remove from blacklist",
            tone: "primary",
          }}
        >
          Remove from blacklist
        </SubmitButton>
      </ActionForm>
    );
  }

  return (
    <ActionForm action={setBlacklistStatus} successMessage="Customer blacklisted." className="space-y-3">
      <input type="hidden" name="customer_id" value={customer.id} />
      <Field
        label="Reason for blacklisting"
        name="blacklist_reason"
        required
        placeholder="e.g. Presented a counterfeit item on 2026-09-12"
        hint="Required. Shown to staff whenever this customer is looked up."
      />
      <SubmitButton
        variant="danger"
        name="is_blacklisted"
        value="on"
        pendingLabel="Updating…"
        confirm={{
          title: "Blacklist this customer?",
          message: `${customer.full_name} will be blocked from all new appraisals and loans until an Admin removes the flag.`,
          confirmLabel: "Blacklist customer",
        }}
      >
        Blacklist customer
      </SubmitButton>
    </ActionForm>
  );
}
