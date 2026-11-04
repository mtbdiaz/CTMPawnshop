"use client"; // runs in the browser: it opens and closes a popup

// useEffect = run code after the page shows; useRef = points at the popup; useState = is it open? anything typed?
import { useEffect, useRef, useState } from "react";
// buttonClasses = the app's button look
import { buttonClasses } from "@/components/ui";
// Icon = the small line icons used across the app
import { Icon } from "@/components/icons";
// the existing register form and its server action (same fields, AML check and duplicate check as before)
import { CustomerForm } from "./customer-form";
import { createCustomer } from "./actions";

// U2: "Register customer" is one button in the page header. It opens the SAME form in a popup,
// so the list isn't pushed down by a big card. Links with ?new=1 (Dashboard quick action) open it straight away.
export function RegisterCustomerDialog({ defaultOpen }: { defaultOpen?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null); // the <dialog> element
  const keepEditing = useRef<HTMLButtonElement>(null); // F9: the "Continue editing" button (gets focus)
  const [open, setOpen] = useState(false); // true while the popup is showing
  const [dirty, setDirty] = useState(false); // F9: true once anything has been typed or picked
  const [confirming, setConfirming] = useState(false); // F9: true while "Discard this registration?" is showing

  // open the popup
  function show() {
    ref.current?.showModal(); // showModal = popup on top, page behind is dimmed and can't be clicked
    setOpen(true);
  }

  // F9: Cancel, X or Esc. If something was typed, ask first; if the form is empty, just close
  function requestClose() {
    if (dirty) setConfirming(true);
    else ref.current?.close();
  }

  // when the page loads with ?new=1, open the popup right away
  useEffect(() => {
    if (defaultOpen) {
      ref.current?.showModal(); // open it
      setOpen(true); // eslint-disable-line react-hooks/set-state-in-effect -- runs once on load to match the popup
    }
  }, [defaultOpen]);

  // F9: put the keyboard on "Continue editing" when the question appears
  useEffect(() => {
    if (confirming) keepEditing.current?.focus();
  }, [confirming]);

  return (
    <>
      {/* the header button */}
      <button type="button" onClick={show} className={buttonClasses("primary")}>
        <Icon name="plus" className="h-4 w-4" />
        Register customer
      </button>

      {/* the popup. Shadow is allowed because it floats above the page.
          onCancel = Esc was pressed: stop the browser closing it, and ask first if needed (F9).
          onClose = it really closed: reset everything. The browser puts the keyboard back on the Register button. */}
      <dialog
        ref={ref}
        aria-labelledby="register-title"
        onCancel={(e) => {
          if (e.target !== e.currentTarget) return; // Esc came from the small "Register this customer?" box inside: let that box handle it
          e.preventDefault(); // don't close yet
          if (!confirming) requestClose(); // ask, or close if nothing typed
        }}
        onClose={(e) => {
          if (e.target !== e.currentTarget) return; // the small confirm box inside closed, not this popup: keep the form
          setOpen(false); // removes the form, so it starts empty next time
          setDirty(false); // nothing typed any more
          setConfirming(false); // hide the question
          // remove ?new=1 from the address so a refresh doesn't open it again
          const url = new URL(window.location.href);
          if (url.searchParams.has("new")) {
            url.searchParams.delete("new");
            window.history.replaceState(null, "", url.toString());
          }
        }}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(48rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-slate-200 p-0 shadow-2xl backdrop:bg-navy-950/50"
      >
        {/* popup header: title + short note + close button */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="register-title" className="text-lg font-semibold text-slate-900">
              Register new customer
            </h2>
            {/* F3: says what happens with the AML result (it never blocks registration) */}
            <p className="mt-0.5 text-sm text-slate-500">
              An AML watchlist check runs when you register. A possible match is still saved, but marked AML flagged for an Admin to review.
            </p>
          </div>
          {/* the X button: same as Cancel (asks first if something was typed) */}
          <button type="button" onClick={requestClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <Icon name="x" className="h-5 w-5" />
          </button>
        {/* end of popup header */}
        </div>

        {/* F9: "Discard this registration?" only shows when closing with something typed */}
        {confirming && (
          <div role="alertdialog" aria-labelledby="discard-title" aria-describedby="discard-text" className="mx-5 mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p id="discard-title" className="font-semibold">
              Discard this registration?
            </p>
            <p id="discard-text" className="mt-0.5">
              What you typed will be lost. Nothing has been saved yet.
            </p>
            {/* the two choices, on the right */}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button ref={keepEditing} type="button" onClick={() => setConfirming(false)} className={buttonClasses("secondary", "sm")}>
                Continue editing
              </button>
              <button type="button" onClick={() => ref.current?.close()} className={buttonClasses("danger", "sm")}>
                Discard
              </button>
            </div>
          {/* end of the question */}
          </div>
        )}

        {/* the form. Only drawn while open, so it starts empty each time.
            onInput / onChange catch any typing or picking inside, to know there's something to lose (F9) */}
        <div className="px-5 py-5" onInput={() => setDirty(true)} onChange={() => setDirty(true)}>
          {open && <CustomerForm action={createCustomer} onCancel={requestClose} />}
        </div>
      {/* end of the popup */}
      </dialog>
    </>
  );
}