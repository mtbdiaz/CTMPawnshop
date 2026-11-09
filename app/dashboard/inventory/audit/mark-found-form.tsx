"use client"; // runs in the browser: the note box and the "Saving" state

import { ActionForm, SubmitButton } from "@/components/form";
import { markAuditItemFound, type ActionState } from "../actions";

// #14: "Mark found" for one item that was missing in a physical audit. A short note (where it was found) is required.
export function MarkFoundForm({ lineId, label }: { lineId: string; label: string }) {
  return (
    <ActionForm<ActionState> action={markAuditItemFound} successMessage={`${label} marked found.`} className="flex flex-wrap items-start gap-2">
      {(state) => (
        <>
          <input type="hidden" name="line_id" value={lineId} />
          <span className="min-w-0 flex-1">
            <input
              type="text"
              name="resolution_notes"
              required
              minLength={5}
              maxLength={500}
              placeholder="Where was it found? e.g. Misplaced on Vault A, shelf 3"
              aria-label={`Where ${label} was found`}
              className="w-full min-w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm placeholder:text-slate-500 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500"
            />
            {state.fieldErrors?.resolution_notes && <span className="mt-1 block text-xs text-red-700">{state.fieldErrors.resolution_notes}</span>}
          </span>
          <SubmitButton variant="secondary" size="sm" pendingLabel="Saving">
            Mark found
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
