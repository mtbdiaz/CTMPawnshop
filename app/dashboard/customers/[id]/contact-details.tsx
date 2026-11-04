"use client"; // runs in the browser: it switches between "showing" and "editing"

// useEffect = run code after the screen updates; useRef = points at a button; useState = remembers what's showing
import { useEffect, useRef, useState, type ReactNode } from "react";
// buttonClasses = the app's button look
import { buttonClasses } from "@/components/ui";
// the same contact form the old profile used (phone, email, address, birthday)
import { CustomerForm } from "../customer-form";
// the server action that saves contact details (checks the role again on the server)
import { updateCustomer } from "../actions";
// the customer row type from the database
import type { Tables } from "@/lib/supabase/database.types";

// PR1: the "Customer details" card on the profile.
// Everyone sees the details (children = the read-only list made on the server, with the masked ID).
// Operator and Admin also get "Edit contact details", which swaps the list for the form in the same spot,
// so nobody has to scroll past Admin forms just to change a phone number.
export function ContactDetails({
  customer, // the customer (its ID number is already masked by the page)
  canEdit, // true for Operator and Admin
  children, // the read-only details list
}: {
  customer: Tables<"customers">; // type of the customer
  canEdit: boolean; // type of canEdit
  children: ReactNode; // type of the details list
}) {
  const [editing, setEditing] = useState(false); // true while the form is open
  const [dirty, setDirty] = useState(false); // true once something was typed in the form
  const [confirming, setConfirming] = useState(false); // true while "Discard your changes?" is showing
  const keepEditing = useRef<HTMLButtonElement>(null); // the "Keep editing" button (gets the keyboard focus)

  // closes the form and resets everything
  function close() {
    setEditing(false); // back to the details list
    setDirty(false); // nothing typed any more
    setConfirming(false); // hide the question
  }

  // Cancel: if something was typed, ask first; otherwise just close
  function requestClose() {
    if (dirty) setConfirming(true); // ask "Discard your changes?"
    else close(); // nothing to lose
  }

  // puts the keyboard on "Keep editing" when the question appears
  useEffect(() => {
    if (confirming) keepEditing.current?.focus(); // so Enter doesn't throw the changes away by accident
  }, [confirming]); // runs when "confirming" changes

  return (
    // the card: white box with a thin border, same as the other cards.
    // h-full = as tall as the Loan record card next to it, so both end on the same line
    <div className="h-full rounded-md border border-slate-200 bg-white p-5">
      {/* card header: title on the left, Edit button on the right */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {/* the card title */}
        <h2 className="text-lg font-semibold text-slate-900">Customer details</h2>
        {/* Edit button: only for Operator/Admin, and only while not already editing */}
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className={buttonClasses("secondary", "sm")}>
            Edit contact details
          </button>
        )}
      {/* end of the card header */}
      </div>

      {/* "Discard your changes?" only shows when Cancel is clicked with something typed */}
      {confirming && (
        <div role="alertdialog" aria-labelledby="discard-contact-title" className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {/* the question */}
          <p id="discard-contact-title" className="font-semibold">
            Discard your changes?
          </p>
          {/* what happens */}
          <p className="mt-0.5">Nothing has been saved yet.</p>
          {/* the two choices, on the right */}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {/* keep the form open */}
            <button ref={keepEditing} type="button" onClick={() => setConfirming(false)} className={buttonClasses("secondary", "sm")}>
              Keep editing
            </button>
            {/* throw the changes away and close the form */}
            <button type="button" onClick={close} className={buttonClasses("danger", "sm")}>
              Discard
            </button>
          {/* end of the choices */}
          </div>
        {/* end of the question */}
        </div>
      )}

      {editing ? (
        // the form. onInput/onChange notice any typing, so Cancel knows there's something to lose
        <div onInput={() => setDirty(true)} onChange={() => setDirty(true)}>
          {/* same form as before; Cancel asks first, and a successful save closes the form */}
          <CustomerForm action={updateCustomer} customer={customer} onCancel={requestClose} onSaved={close} />
        {/* end of the form wrapper */}
        </div>
      ) : (
        // not editing: the read-only details list from the server
        children
      )}
    {/* end of the card */}
    </div>
  );
}
