"use client"; // runs in the browser: the button, the popup and the "Saving" state

// useRef = points at the popup; useState = is it open?
import { useRef, useState } from "react";
// the app's standard form (no double submits, toast, errors), its submit button and note box
import { ActionForm, SubmitButton, TextareaField } from "@/components/form";
// buttonClasses = the app's button look; Icon = the small line icons
import { buttonClasses } from "@/components/ui";
import { Icon } from "@/components/icons";
// R3: the contact methods and results (same words everywhere)
import { METHODS, OUTCOMES } from "@/lib/compliance/reminder-outcomes";
import { logContact, type ActionState } from "../actions"; // the server action that saves the log

// R1 + R3: "Log contact" on the Reminders page. It opens a small popup where staff pick HOW they contacted the
// customer and WHAT happened, plus an optional note the Admin can read (e.g. "will pay on Friday").
// The popup itself is the confirm step, so a mis-click on the button saves nothing.
// PawnTrack does not send any SMS or email; this only records what staff did.
export function LogContactButton({
  loanId, // the loan to log
  ticketNumber, // shown in the popup
  customerName, // shown in the popup and the toast
  contactNumber, // shown in the popup
  dueText, // e.g. "Nov 9, 2026 (Due tomorrow)"
  again, // true = something was already logged for this due date, so the button says "Log again"
}: {
  loanId: string;
  ticketNumber: string;
  customerName: string;
  contactNumber: string;
  dueText: string;
  again: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null); // the <dialog> element
  const [open, setOpen] = useState(false); // true while the popup shows (the form is only drawn then, so it starts empty)
  const titleId = `log-title-${loanId}`; // one popup per row, so ids must be different

  // open the popup on top of the page
  function show() {
    ref.current?.showModal();
    setOpen(true);
  }

  return (
    <>
      {/* the row button. "Log again" is quieter, so the rows still to contact stand out */}
      <button type="button" onClick={show} className={buttonClasses(again ? "ghost" : "secondary", "sm") + " whitespace-nowrap"}>
        {again ? "Log again" : "Log contact"}
      </button>

      {/* the popup. onClose = it closed (Esc, X, Cancel or saved): remove the form so it starts empty next time */}
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClose={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-slate-200 p-0 text-left shadow-2xl backdrop:bg-navy-950/50"
      >
        {/* header: who and which loan */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-slate-900">
              Log contact for {customerName}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {contactNumber || "No mobile on file"} · {ticketNumber} · Due {dueText}
            </p>
          </div>
          {/* X = close without saving */}
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <Icon name="x" className="h-5 w-5" />
          </button>
        </div>

        {open && (
          <ActionForm<ActionState>
            action={logContact}
            className="space-y-4 px-5 py-5"
            successMessage={`Contact logged for ${customerName} (${ticketNumber}).`}
            onSuccess={() => ref.current?.close()} // saved: close the popup, the list refreshes
          >
            {(state) => (
              <>
                <input type="hidden" name="loan_id" value={loanId} />

                {/* how they were contacted (Call is picked by default, the most common) */}
                <fieldset>
                  <legend className="text-sm font-medium text-slate-700">How did you contact them?</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {METHODS.map((m) => (
                      <label key={m.value} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 text-sm text-slate-800 has-[:checked]:border-navy-600 has-[:checked]:bg-navy-50">
                        <input type="radio" name="contact_method" value={m.value} defaultChecked={m.value === "call"} className="h-4 w-4 text-navy-700 focus:ring-navy-500" />
                        {m.label}
                      </label>
                    ))}
                  </div>
                  {state.fieldErrors?.contact_method && <p className="mt-1 text-sm text-red-700">{state.fieldErrors.contact_method}</p>}
                </fieldset>

                {/* what happened (required, nothing picked by default so staff really choose) */}
                <fieldset>
                  <legend className="text-sm font-medium text-slate-700">
                    What happened? <span className="text-red-700">*</span>
                  </legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {OUTCOMES.map((o) => (
                      <label key={o.value} className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm has-[:checked]:border-navy-600 has-[:checked]:bg-navy-50">
                        <input type="radio" name="outcome" value={o.value} required className="mt-0.5 h-4 w-4 text-navy-700 focus:ring-navy-500" />
                        <span>
                          <span className="block font-medium text-slate-800">{o.label}</span>
                          <span className="block text-xs text-slate-500">{o.help}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {state.fieldErrors?.outcome && <p className="mt-1 text-sm text-red-700">{state.fieldErrors.outcome}</p>}
                </fieldset>

                {/* optional note the Admin can read */}
                <TextareaField
                  label="Note (optional)"
                  name="notes"
                  rows={2}
                  maxLength={500}
                  placeholder="e.g. Will pay on Friday. Asked to call back after 5 PM."
                  hint="Up to 500 characters. Shown in the loan's contact history."
                />

                {/* says plainly that nothing is sent */}
                <p className="text-xs text-slate-500">This only records what you did. PawnTrack does not send any SMS or email.</p>

                {/* Cancel / Save */}
                <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
                  <button type="button" onClick={() => ref.current?.close()} className={buttonClasses("secondary")}>
                    Cancel
                  </button>
                  <SubmitButton pendingLabel="Saving">Save log</SubmitButton>
                </div>
              </>
            )}
          </ActionForm>
        )}
      </dialog>
    </>
  );
}
