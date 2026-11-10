"use client"; // has a form with a search box

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { setAppraisalCustomer } from "../actions";
import { CustomerPicker } from "../customer-picker";

// #38: put or correct the customer on an appraisal that is not pawned yet (Appraiser or Admin).
// updatedAt = when the page loaded the appraisal, so a change made by someone else in the meantime is not overwritten.
export function SetCustomerForm({ appraisalId, updatedAt, currentName }: { appraisalId: string; updatedAt: string; currentName: string | null }) {
  const [picked, setPicked] = useState<string | null>(null); // the name of the customer picked in the box
  return (
    <ActionForm action={setAppraisalCustomer} successMessage="Customer saved on this appraisal." className="max-w-xl space-y-3">
      <input type="hidden" name="appraisal_id" value={appraisalId} />
      <input type="hidden" name="updated_at" value={updatedAt} />
      <CustomerPicker onPicked={(c) => setPicked(c?.full_name ?? null)} />
      <SubmitButton
        pendingLabel="Saving"
        disabled={!picked}
        confirm={{
          title: currentName ? "Change the customer?" : "Set the customer?",
          message: currentName
            ? "Only this customer will be able to pawn the item. The change is saved in the audit trail."
            : "Only this customer will be able to pawn the item. This is saved in the audit trail.",
          confirmLabel: currentName ? "Change customer" : "Set customer",
          tone: "primary",
          details: [
            ["Now", currentName ?? "No customer"],
            ["New", picked ?? ""],
          ],
        }}
      >
        {currentName ? "Change customer" : "Set customer"}
      </SubmitButton>
    </ActionForm>
  );
}
