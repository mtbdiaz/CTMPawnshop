"use client"; // runs in the browser: the eye button reacts to clicks

// useEffect = runs the 30-second auto-hide timer; useState = what is shown; useTransition = "is it loading?"
import { useEffect, useState, useTransition } from "react";
// the server action that checks the role and sends back ONE full ID
import { revealCustomerId } from "./actions";

// Open eye = "show", eye with a line = "hide". Drawn here so no new icon file is needed.
function EyeIcon({ off }: { off?: boolean }) {
  return (
    // aria-hidden = screen readers skip the picture; the button's label says what it does
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      {/* the eye shape */}
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12" />
      {/* the pupil */}
      <circle cx="12" cy="12" r="3" />
      {/* the line across, only for "hide" */}
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

// P3: shows a masked ID ("•••• 0418"). Staff allowed to see full IDs get an eye button next to it.
// Clicking asks the SERVER for this one customer's full number (the server checks the role again),
// shows it, and hides it again after 30 seconds, when clicked again, or when leaving the page.
// Nothing is saved in the browser or the address.
export function IdReveal({
  customerId, // which customer
  masked, // the masked text made on the server, e.g. "•••• 0418"
  ending, // the last 4, for screen readers
  canReveal, // true for Admin, Operator, Cashier (see lib/customers/id-privacy.ts)
}: {
  customerId: string;
  masked: string;
  ending: string;
  canReveal: boolean;
}) {
  const [full, setFull] = useState<string | null>(null); // the full number while it's showing, otherwise null
  const [error, setError] = useState<string | null>(null); // a short message if the server says no
  const [pending, startTransition] = useTransition(); // true while waiting for the server

  // auto-hide: 30 seconds after showing, go back to the masked number
  useEffect(() => {
    if (!full) return; // nothing showing, no timer needed
    const t = setTimeout(() => setFull(null), 30_000); // 30,000 ms = 30 seconds
    return () => clearTimeout(t); // cancel the timer if it's hidden earlier or the page closes
  }, [full]);

  // what happens when the eye button is clicked
  function toggle() {
    if (full) {
      setFull(null); // already showing -> hide it
      return;
    }
    setError(null); // clear any old message
    startTransition(async () => {
      const res = await revealCustomerId(customerId); // ask the server
      if (res.idNumber) setFull(res.idNumber); // allowed -> show it
      else setError(res.error ?? "Could not show the ID."); // not found or not allowed
    });
  }

  return (
    // inline-flex keeps the number and the button on one line
    <span className="inline-flex items-center gap-1">
      {/* the number: full while revealed, masked otherwise. aria-live = screen readers hear the change */}
      <span className="font-mono text-xs" aria-live="polite" aria-label={full ? `ID number ${full}` : `ID ending in ${ending}`}>
        {full ?? masked}
      </span>
      {/* the eye button, only for roles allowed to see full IDs */}
      {canReveal && (
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-label={full ? "Hide full ID number" : "Show full ID number"}
          title={full ? "Hide full ID number" : "Show full ID number (hides again after 30 seconds)"}
          className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-navy-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 disabled:opacity-50"
        >
          <EyeIcon off={Boolean(full)} />
        </button>
      )}
      {/* short error text, if the server said no */}
      {error && <span className="text-xs text-red-700">{error}</span>}
    {/* end of the ID */}
    </span>
  );
}

// the same eye pictures, for the "Hide IDs / Show IDs" column button on the list
export { EyeIcon };