"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { resolveCounterfeitFlag } from "../actions";

export function ResolveForm({ appraisalId }: { appraisalId: string }) {
  return (
    <ActionForm action={resolveCounterfeitFlag} successMessage="Counterfeit flag resolved." className="mt-4 flex flex-wrap gap-2">
      <input type="hidden" name="appraisal_id" value={appraisalId} />
      <SubmitButton
        name="decision"
        value="cleared"
        variant="success"
        pendingLabel="Saving…"
        confirm={{
          title: "Clear this flag?",
          message: "You're confirming the item is genuine. A Cashier will be able to issue a loan against it.",
          confirmLabel: "Clear flag",
          tone: "primary",
        }}
      >
        Clear flag — item is genuine
      </SubmitButton>
      <SubmitButton
        name="decision"
        value="confirmed"
        variant="danger"
        pendingLabel="Saving…"
        confirm={{
          title: "Confirm counterfeit risk?",
          message: "No loan can ever be issued against this item. Consider also blacklisting the customer.",
          confirmLabel: "Confirm risk",
        }}
      >
        Confirm risk — stop transaction
      </SubmitButton>
    </ActionForm>
  );
}
