"use client"; // runs in the browser: the popup and its form

import { ActionForm, Field, SubmitButton } from "@/components/form";
import { PopupButton } from "@/components/popup-button"; // a button that opens a small popup on the same page
import { discardAudit, type ActionState } from "../actions";

// DD1 (Nov 12, migration 0048): "Discard draft" for an audit that is in progress, on the Physical audit page and
// inside the audit. Shown only to the person who started the draft and to an Admin (the database checks it again).
// The draft is not deleted: it is marked discarded with who, when and why, and its checks are kept.
// checked = how many items already have a saved result; when it is more than 0 an extra tick is needed.
export function DiscardDraft({
  auditId,
  location,
  checked,
  total,
  label = "Discard draft",
  onDone,
}: {
  auditId: string;
  location: string; // "Safe 1" or "All locations"
  checked: number;
  total: number;
  label?: string;
  onDone?: () => void; // e.g. go back to the Physical audit page
}) {
  return (
    // min-h-10 below the "lg" width: a 40px touch target on phones and tablets; on a computer the row stays compact
    <PopupButton label={label} title="Discard this draft?" className="min-h-10 text-slate-700 lg:min-h-0">
      <ActionForm<ActionState> action={discardAudit} className="space-y-3 text-sm" successMessage={`Draft of ${location} discarded.`} onSuccess={onDone}>
        {(state) => (
          <>
            <p className="text-slate-900">
              <span className="font-semibold">{location}</span> · {checked.toLocaleString("en-PH")} of {total.toLocaleString("en-PH")} checked
            </p>
            <p className="text-slate-700">
              Discarding takes this draft off the in-progress list, and a new audit of this location can then be started. It is not deleted: the draft and its checks are kept in the records, marked discarded with your name and the reason.
            </p>
            <input type="hidden" name="audit_id" value={auditId} />
            <Field label="Why is it discarded?" name="reason" required minLength={5} maxLength={300} placeholder="e.g. Started for the wrong location" />
            {/* a draft with saved work needs a clear second yes */}
            {checked > 0 && (
              <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-950">
                <input type="checkbox" name="confirm_checks" required className="mt-0.5 h-4 w-4 rounded border-slate-400 text-navy-700 focus:ring-navy-500" />
                <span>
                  This draft has {checked.toLocaleString("en-PH")} saved {checked === 1 ? "check" : "checks"}. I want to discard it anyway.
                  {state.fieldErrors?.confirm_checks && <span className="block text-xs font-medium text-red-700">{state.fieldErrors.confirm_checks}</span>}
                </span>
              </label>
            )}
            <SubmitButton variant="danger" pendingLabel="Discarding">
              Discard draft
            </SubmitButton>
          </>
        )}
      </ActionForm>
    </PopupButton>
  );
}
