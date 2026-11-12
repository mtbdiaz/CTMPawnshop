"use client";

import { ActionForm, Field, SubmitButton } from "@/components/form";
import { setBlacklistStatus } from "../actions";
import type { Tables } from "@/lib/supabase/database.types";

export function BlacklistForm({ customer }: { customer: Tables<"customers"> }) {
  if (customer.is_blacklisted) {
    return (
      <ActionForm action={setBlacklistStatus} successMessage="Customer removed from the blacklist." className="space-y-3">
        <input type="hidden" name="customer_id" value={customer.id} />
        {/* BL1 (Nov 12): the words match what the database does (migrations 0063 and create_pawn_loan) */}
        <p className="text-sm text-slate-600">
          Removing the blacklist lets this customer get new appraisals and loans again.
        </p>
        <SubmitButton
          variant="secondary"
          pendingLabel="Updating"
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
        pendingLabel="Updating"
        confirm={{
          title: "Blacklist this customer?",
          // BL1 (Nov 12): before, it said "until an Admin removes the flag", which is not how it is lifted, and didn't
          // say what happens to the loans they already have
          message: `${customer.full_name} can't get new appraisals or new loans until an Admin presses Remove from blacklist here. Loans they already have don't change: they can still pay, renew and redeem them. The reason is shown to staff when a loan or appraisal is refused.`,
          confirmLabel: "Blacklist customer",
        }}
      >
        Blacklist customer
      </SubmitButton>
    </ActionForm>
  );
}
