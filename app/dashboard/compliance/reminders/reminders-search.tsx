"use client"; // runs in the browser: it reacts to typing

// useRef = remembers the timer between key presses; useState = the text in the box; useTransition = "is the list loading?"
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation"; // changes the page address without a full reload
import { Icon } from "@/components/icons"; // the small line icons

// R1: search while typing, the same as the Loans, Customers and Appraisals searches.
// Waits 300ms after the last key (Enter searches at once), keeps the tab and Due filter, and goes back to page 1.
export function RemindersSearch({ defaultValue, keep }: { defaultValue?: string; keep: Record<string, string | undefined> }) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue ?? ""); // what is typed in the box
  const [pending, startTransition] = useTransition(); // true while the new list loads
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null); // the 300ms wait timer

  // R1: the search can also change from a link (the "3 loans due" badge, the summary numbers). Then the box shows the
  // new text too, so it's clear why the list is filtered. Compared without spaces at the ends, so a space you just
  // typed isn't removed while the list loads.
  const [shownDefault, setShownDefault] = useState(defaultValue); // the search text the page last gave us
  if (defaultValue !== shownDefault) {
    setShownDefault(defaultValue);
    if ((defaultValue ?? "") !== value.trim()) setValue(defaultValue ?? "");
  }

  // builds the address for a search and opens it
  function go(text: string) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) qs.set(k, v); // keep the tab and Due filter
    if (text.trim()) qs.set("q", text.trim()); // the search text, if any
    const str = qs.toString();
    // replace (not push) so every letter typed doesn't add a Back step; scroll: false = stay where you are
    startTransition(() => router.replace(str ? `/dashboard/compliance/reminders?${str}` : "/dashboard/compliance/reminders", { scroll: false }));
  }

  // runs on every key press
  function onChange(text: string) {
    setValue(text);
    if (timer.current) clearTimeout(timer.current); // cancel the previous wait
    timer.current = setTimeout(() => go(text), 300); // search 300ms after the last key
  }

  return (
    <form
      role="search"
      className="relative w-full" // as wide as its column (the toolbar sets the width)
      onSubmit={(e) => {
        e.preventDefault(); // no full page reload
        if (timer.current) clearTimeout(timer.current); // Enter = search now
        go(value);
      }}
    >
      <label htmlFor="reminders-search" className="sr-only">
        Search reminders by customer name, mobile number or ticket number
      </label>
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        id="reminders-search"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search name, mobile or ticket"
        autoComplete="off"
        maxLength={60}
        // pr-24 (room for "Searching" + the clear button) only while something is typed or loading; otherwise pr-3, so the hint text isn't cut off
        className={`w-full rounded-md border border-slate-300 bg-white py-2 pl-9 ${value || pending ? "pr-24" : "pr-3"} text-sm placeholder:text-slate-500 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20 [&::-webkit-search-cancel-button]:hidden`}
      />
      {/* right side: loading text + clear button */}
      <span className="absolute inset-y-0 right-2 flex items-center gap-1">
        <span aria-live="polite" className="text-xs text-slate-500">
          {pending ? "Searching" : ""}
        </span>
        {value && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              if (timer.current) clearTimeout(timer.current);
              setValue("");
              go("");
            }}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <Icon name="x" className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    </form>
  );
}
