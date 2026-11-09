"use client";

import { ActionForm, SubmitButton, TextareaField } from "@/components/form"; // #28: TextareaField for the reason
import { resolveCounterfeitFlag } from "../actions";

export function ResolveForm({ appraisalId, updatedAt }: { appraisalId: string; updatedAt: string }) {
  return (
    <ActionForm action={resolveCounterfeitFlag} successMessage="Counterfeit flag resolved." className="mt-4 flex flex-wrap gap-2">
      <input type="hidden" name="appraisal_id" value={appraisalId} />
      <input type="hidden" name="updated_at" value={updatedAt} /> {/* the version the Admin is looking at */}
      {/* #28: why the Admin decided; saved with the decision and shown to everyone on this page */}
      <TextareaField
        label="Reason for your decision"
        name="resolution_notes"
        required
        rows={2}
        maxLength={500}
        placeholder="e.g. Acid test passed and hallmark matches 18K. / Magnet test failed, plating under the clasp."
        hint="Required. Shown on this page with your name."
        className="w-full basis-full"
      />
      <SubmitButton
        name="decision"
        value="cleared"
        variant="success"
        pendingLabel="Saving"
        confirm={{
          title: "Clear this flag?",
          message: "You are confirming the item is genuine. A Cashier will be able to issue a loan against it.",
          confirmLabel: "Clear flag",
          tone: "primary",
        }}
      >
        Clear flag: item is genuine
      </SubmitButton>
      <SubmitButton
        name="decision"
        value="confirmed"
        variant="danger"
        pendingLabel="Saving"
        confirm={{
          title: "Confirm counterfeit risk?",
          message: "No loan can ever be issued against this item. Consider also blacklisting the customer.",
          confirmLabel: "Confirm risk",
        }}
      >
        Confirm risk: stop transaction
      </SubmitButton>
    </ActionForm>
  );
}
