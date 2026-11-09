"use client"; // runs in the browser: the button, its confirm popup and the "Logging" state

import { ActionForm, SubmitButton } from "@/components/form"; // the app's standard form (no double submits, toast, errors)
import { logContact, type ActionState } from "../actions"; // the server action that saves the log

// R1: "Log contact" on the Reminders page (was "Mark reminded").
// A small popup first says what will be saved, so a mis-click doesn't log a call that never happened,
// and says plainly that PawnTrack doesn't send anything. Two clicks in total, so many calls stay quick.
// R2: the database can't save the RESULT of a call yet (reached, no answer, wrong number; Matt #34), so a log is
// only an attempt. The popup says so, and staff log every try, even when nobody answers.
export function LogContactButton({
  loanId, // the loan to log
  ticketNumber, // shown in the popup
  customerName, // shown in the popup and the toast
  contactNumber, // shown in the popup
  dueText, // e.g. "Nov 9, 2026 (Due tomorrow)"
  again, // true = contact was already logged for this due date, so the button says "Log again"
}: {
  loanId: string;
  ticketNumber: string;
  customerName: string;
  contactNumber: string;
  dueText: string;
  again: boolean;
}) {
  return (
    <ActionForm<ActionState> action={logContact} successMessage={`Contact attempt logged for ${customerName} (${ticketNumber}).`}>
      <input type="hidden" name="loan_id" value={loanId} />
      <SubmitButton
        variant={again ? "ghost" : "secondary"} // "Log again" is quieter, so the rows still to contact stand out
        size="sm"
        pendingLabel="Logging"
        className="whitespace-nowrap"
        confirm={{
          title: again ? "Log another contact attempt?" : "Log contact attempt?",
          message:
            "This records that you called, texted or talked to the customer about this loan, even if they didn't answer. PawnTrack can't save the result yet (reached, no answer, wrong number), and it does not send any SMS or email.",
          confirmLabel: "Log contact",
          tone: "primary",
          details: [
            ["Customer", customerName],
            ["Mobile", contactNumber || "None on file"],
            ["Ticket", ticketNumber],
            ["Due", dueText],
          ],
        }}
      >
        {again ? "Log again" : "Log contact"}
      </SubmitButton>
    </ActionForm>
  );
}
