"use client"; // runs in the browser: the button and its confirm box

import { ActionForm, SubmitButton } from "@/components/form";
import { checkDefaultsNow, type DefaultCheckState } from "./actions";

// L0 (Phase 0): the Admin runs default detection on purpose. Opening the Loans list no longer does it.
// L30: it lives in Admin actions under the list, after a preview of exactly which loans would change.
// expected = the previewed list; the server refuses if the list changed since (and if a paid loan is in it, Matt #1).
export function DefaultCheckButton({ expected, count, disabled }: { expected: string; count: number; disabled?: boolean }) {
  const plural = count === 1 ? "" : "s";
  return (
    <ActionForm<DefaultCheckState> action={checkDefaultsNow} successMessage={(s) => s.message ?? "Default check done."}>
      {/* the list the Admin is looking at, so the server can check it didn't change */}
      <input type="hidden" name="expected" value={expected} />
      <SubmitButton
        variant="danger"
        pendingLabel="Marking as defaulted"
        disabled={disabled}
        confirm={{
          title: `Mark ${count} loan${plural} as defaulted?`,
          message: `The ${count} loan${plural} listed above move to Defaulted, and their items go to the forfeit list. A Cashier can still reinstate a loan, and an Admin decides to forfeit each one. Each change is saved in the audit trail.`,
          confirmLabel: `Mark ${count} as defaulted`,
          tone: "danger",
        }}
      >
        Mark {count} loan{plural} as defaulted
      </SubmitButton>
    </ActionForm>
  );
}
