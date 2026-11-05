"use client"; // runs in the browser: the button and its confirm box

import { ActionForm, SubmitButton } from "@/components/form";
import { checkDefaultsNow, type DefaultCheckState } from "./actions";

// L0 (Phase 0): the Admin runs default detection on purpose. Opening the Loans list no longer does it.
// The server refuses if a fully paid loan would be wrongly defaulted (until Matt fixes #1).
export function DefaultCheckButton() {
  return (
    <ActionForm<DefaultCheckState> action={checkDefaultsNow} successMessage={(s) => s.message ?? "Default check done."}>
      <SubmitButton
        variant="secondary"
        pendingLabel="Checking"
        confirm={{
          title: "Check for defaults now?",
          message:
            "Running loans past their due date plus the grace period are moved to Defaulted, and their items to the forfeit list. An Admin still decides to forfeit or reinstate each one.",
          confirmLabel: "Check now",
          tone: "primary",
        }}
      >
        Check for defaults now
      </SubmitButton>
    </ActionForm>
  );
}
