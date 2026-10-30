"use client"; // runs in the browser: it opens and closes a popup

// useEffect = run code after the page shows; useRef = points at the popup; useState = is it open?
import { useEffect, useRef, useState } from "react";
// buttonClasses = the app's button look
import { buttonClasses } from "@/components/ui";
// Icon = the small line icons used across the app
import { Icon } from "@/components/icons";
// the existing register form and its server action (same fields, AML check and duplicate check as before)
import { CustomerForm } from "./customer-form";
import { createCustomer } from "./actions";

// U2: "Register customer" is now one button in the page header. It opens the SAME form in a popup,
// so the list isn't pushed down by a big card. Links with ?new=1 (Dashboard quick action) open it straight away.
export function RegisterCustomerDialog({ defaultOpen }: { defaultOpen?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null); // the <dialog> element
  const [open, setOpen] = useState(false); // true while the popup is showing

  // open the popup
  function show() {
    ref.current?.showModal(); // showModal = popup on top, page behind is dimmed and can't be clicked
    setOpen(true);
  }

  // when the page loads with ?new=1, open the popup right away
  useEffect(() => {
    if (defaultOpen) {
      ref.current?.showModal(); // open it
      setOpen(true); // eslint-disable-line react-hooks/set-state-in-effect -- runs once on load to match the popup
    }
  }, [defaultOpen]);

  return (
    <>
      {/* the header button */}
      <button type="button" onClick={show} className={buttonClasses("primary")}>
        <Icon name="plus" className="h-4 w-4" />
        Register customer
      </button>

      {/* the popup. onClose also runs when Esc is pressed. Shadow is allowed because it floats above the page */}
      <dialog
        ref={ref}
        aria-labelledby="register-title"
        onClose={() => {
          setOpen(false); // mark it closed
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
            <p className="mt-0.5 text-sm text-slate-500">An AML identity check runs automatically on registration.</p>
          </div>
          {/* the X button closes the popup without saving */}
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <Icon name="x" className="h-5 w-5" />
          </button>
        {/* end of popup header */}
        </div>
        {/* the form. Only drawn while open, so it starts empty each time */}
        <div className="px-5 py-5">{open && <CustomerForm action={createCustomer} />}</div>
      {/* end of the popup */}
      </dialog>
    </>
  );
}