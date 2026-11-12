"use client"; // runs in the browser: a search box that finds customers as you type

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useFieldError } from "@/components/form"; // the server's error for this field, if any
import { cx } from "@/components/ui";
import { customerNo } from "@/lib/ref-numbers"; // C-0012
import { findCustomersForAppraisal, type CustomerOption } from "./actions";

/**
 * #38: picks the customer an appraised item belongs to. Used by New appraisal and by "Change customer".
 * It puts the picked customer's id in a hidden input called customer_id, so the form sends it.
 * Search by name, phone or C-number (at least 2 characters). Arrow keys + Enter work like on New Loan.
 */
export function CustomerPicker({
  initial = null,
  onPicked,
}: {
  initial?: CustomerOption | null; // already chosen (e.g. the appraisal's current customer)
  onPicked?: (c: CustomerOption | null) => void; // tells the form who is picked (null = cleared)
}) {
  const [picked, setPicked] = useState<CustomerOption | null>(initial);
  const [q, setQ] = useState(""); // what is typed
  const [hits, setHits] = useState<CustomerOption[]>([]); // what the search found
  const [active, setActive] = useState(0); // the highlighted row (arrow keys)
  const [searched, setSearched] = useState(""); // the text the shown results belong to
  const [limited, setLimited] = useState(false); // true = too many searches this minute
  const [pending, startTransition] = useTransition();
  const listId = useId();
  const seq = useRef(0); // so a slow old answer can't replace a newer one
  const error = useFieldError("customer_id");

  // search a moment after typing stops
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      startTransition(async () => {
        const res = await findCustomersForAppraisal(term);
        if (mine !== seq.current) return; // a newer search is on its way
        const overLimit = !Array.isArray(res);
        setLimited(overLimit);
        setHits(overLimit ? [] : res);
        setActive(0);
        setSearched(term);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function pick(c: CustomerOption | null) {
    setPicked(c);
    setQ("");
    setHits([]);
    onPicked?.(c);
  }

  const shown = q.trim().length >= 2 ? hits : [];

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") e.preventDefault(); // Enter picks a customer, it must not send the whole form
    if (!shown.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % shown.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + shown.length) % shown.length);
    } else if (e.key === "Enter") {
      pick(shown[active]);
    }
  }

  return (
    <div>
      <p id={`${listId}-label`} className="block text-sm font-medium text-slate-700">
        Customer
        <span className="ml-0.5 text-red-600" aria-hidden="true">
          *
        </span>
      </p>
      {/* what the form sends */}
      <input type="hidden" name="customer_id" value={picked?.id ?? ""} />
      {picked ? (
        // someone is picked: show who, with a way to pick someone else
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
          <span>
            <span className="font-medium text-slate-900">{picked.full_name}</span>
            <span className="ml-1.5 font-mono text-xs text-slate-500">{customerNo(picked.customer_no)}</span>
            {picked.blacklisted && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-800">Blacklisted: a new appraisal will be refused</span>}
            <span className="ml-2 text-xs text-slate-600">{picked.id_hint}</span>
          </span>
          <button type="button" onClick={() => pick(null)} className="rounded-sm text-sm font-medium text-navy-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            role="combobox"
            aria-labelledby={`${listId}-label`}
            aria-expanded={shown.length > 0}
            aria-controls={listId}
            aria-activedescendant={shown.length ? `${listId}-${active}` : undefined}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search by name, phone or C-number"
            className={cx("mt-1 block w-full rounded-md border px-3 py-2 text-sm", error ? "border-red-500" : "border-slate-300")}
          />
          <ul id={listId} role="listbox" className={cx("mt-1 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white", !shown.length && "hidden")}>
            {shown.map((c, i) => (
              <li
                key={c.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep the keyboard in the box
                  pick(c);
                }}
                className={cx("flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm", i === active && "bg-navy-50")}
              >
                <span>
                  <span className="font-medium text-slate-900">{c.full_name}</span>
                  <span className="ml-1.5 font-mono text-xs text-slate-500">{customerNo(c.customer_no)}</span>
                  {/* BL1: a new appraisal for this customer is refused, so say it before they are picked */}
                  {c.blacklisted && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-800">Blacklisted</span>}
                </span>
                <span className="text-xs text-slate-600">{c.id_hint}</span>
              </li>
            ))}
          </ul>
          <p className={cx("mt-1 text-xs", error ? "font-medium text-red-700" : "text-slate-500")} aria-live="polite">
            {pending
              ? "Searching"
              : limited && searched === q.trim()
                ? "Too many searches. Wait a minute, then try again."
                : q.trim().length >= 2 && searched === q.trim() && !hits.length
                  ? "No customer found. An Operator registers new customers under Customers."
                  : (error ?? "The person who brought the item in. Check the name and the last 4 of the ID.")}
          </p>
        </>
      )}
    </div>
  );
}
