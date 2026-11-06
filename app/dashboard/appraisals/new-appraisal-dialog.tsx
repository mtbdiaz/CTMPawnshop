"use client"; // runs in the browser: it opens and closes a popup

// useEffect = run code after the page shows; useRef = points at the popup; useState = is it open? anything typed?
import { useEffect, useRef, useState } from "react";
import { buttonClasses } from "@/components/ui"; // the app's button look
import { Icon } from "@/components/icons"; // the small line icons
import type { KaratPrices } from "@/lib/appraisal/valuation";
import { AppraisalCalculator } from "./appraisal-calculator"; // the same calculator as before (value + maximum loan as you type)

// C1: "New appraisal" is one button in the page header. It opens the calculator in a popup,
// so the list isn't pushed down. Same look and behavior as Register customer:
// Cancel, X or Esc asks "Discard this appraisal?" if anything was entered. ?new=1 opens it straight away.
export function NewAppraisalDialog({ prices, ltvPercent, defaultOpen }: { prices: KaratPrices; ltvPercent: number; defaultOpen?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null); // the <dialog> element
  const keepEditing = useRef<HTMLButtonElement>(null); // the "Continue editing" button (gets focus)
  const [open, setOpen] = useState(false); // true while the popup is showing
  const [dirty, setDirty] = useState(false); // true once anything has been entered
  const [confirming, setConfirming] = useState(false); // true while "Discard this appraisal?" is showing

  // open the popup
  function show() {
    ref.current?.showModal(); // popup on top, the page behind is dimmed and can't be clicked
    setOpen(true);
  }

  // Cancel, X or Esc: ask first if something was entered, otherwise just close
  function requestClose() {
    if (dirty) setConfirming(true);
    else ref.current?.close();
  }

  // the page opened with ?new=1 (Dashboard quick action): open the popup right away
  useEffect(() => {
    if (defaultOpen) {
      ref.current?.showModal();
      setOpen(true); // eslint-disable-line react-hooks/set-state-in-effect -- runs once on load to match the popup
    }
  }, [defaultOpen]);

  // put the keyboard on "Continue editing" when the question appears
  useEffect(() => {
    if (confirming) keepEditing.current?.focus();
  }, [confirming]);

  return (
    <>
      {/* the header button */}
      <button type="button" onClick={show} className={buttonClasses("primary")}>
        <Icon name="plus" className="h-4 w-4" />
        New appraisal
      </button>

      {/* the popup. onCancel = Esc: ask first. onClose = it really closed: reset everything.
          e.target check: a small confirm box inside closing must not close this popup (same fix as Register customer) */}
      <dialog
        ref={ref}
        aria-labelledby="new-appraisal-title"
        onCancel={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault(); // don't close yet
          if (!confirming) requestClose();
        }}
        onClose={(e) => {
          if (e.target !== e.currentTarget) return;
          setOpen(false); // removes the form, so it starts empty next time
          setDirty(false);
          setConfirming(false);
          // remove ?new=1 from the address so a refresh doesn't open it again
          const url = new URL(window.location.href);
          if (url.searchParams.has("new")) {
            url.searchParams.delete("new");
            window.history.replaceState(null, "", url.toString());
          }
        }}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(60rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-slate-200 p-0 shadow-2xl backdrop:bg-navy-950/50"
      >
        {/* popup header: title + short note + close button */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="new-appraisal-title" className="text-lg font-semibold text-slate-900">
              New appraisal
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">Pick the category and karat, then enter the weight. Value and maximum loan update as you type.</p>
          </div>
          <button type="button" onClick={requestClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <Icon name="x" className="h-5 w-5" />
          </button>
        </div>

        {/* "Discard this appraisal?" only shows when closing with something entered */}
        {confirming && (
          <div role="alertdialog" aria-labelledby="discard-appraisal-title" aria-describedby="discard-appraisal-text" className="mx-5 mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p id="discard-appraisal-title" className="font-semibold">
              Discard this appraisal?
            </p>
            <p id="discard-appraisal-text" className="mt-0.5">
              What you entered will be lost. Nothing has been saved yet.
            </p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button ref={keepEditing} type="button" onClick={() => setConfirming(false)} className={buttonClasses("secondary", "sm")}>
                Continue editing
              </button>
              <button type="button" onClick={() => ref.current?.close()} className={buttonClasses("danger", "sm")}>
                Discard
              </button>
            </div>
          </div>
        )}

        {/* the calculator. Only drawn while open, so it starts empty each time.
            onInput / onChange catch any typing or picking inside, to know there's something to lose */}
        <div className="px-5 py-5" onInput={() => setDirty(true)} onChange={() => setDirty(true)}>
          {open && <AppraisalCalculator prices={prices} ltvPercent={ltvPercent} onCancel={requestClose} />}
        </div>
      </dialog>
    </>
  );
}
