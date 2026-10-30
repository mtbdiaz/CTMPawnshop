"use client"; // runs in the browser: it reacts to typing

// useRef = remembers the timer between key presses; useState = the text in the box; useTransition = "is the list loading?"
import { useRef, useState, useTransition } from "react";
// useRouter = changes the page address without a full reload
import { useRouter } from "next/navigation";
// Icon = the small line icons used across the app
import { Icon } from "@/components/icons";

// U1: search while typing. Waits 300ms after the last key, then updates the list.
// It keeps the current filter tab and sort order, and goes back to page 1.
export function CustomerSearch({
  defaultValue, // the search already in the address (e.g. after pressing Back)
  keep, // the other things in the address to keep (filter tab, sort, direction)
}: {
  defaultValue?: string;
  keep: Record<string, string | undefined>;
}) {
  const router = useRouter(); // used to change the address
  const [value, setValue] = useState(defaultValue ?? ""); // what is typed in the box
  const [pending, startTransition] = useTransition(); // pending = true while the new list loads
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null); // the 300ms wait timer

  // builds the address for a search and opens it
  function go(text: string) {
    const qs = new URLSearchParams(); // the "?a=1&b=2" part
    for (const [k, v] of Object.entries(keep)) if (v) qs.set(k, v); // keep the filter tab and sort
    if (text.trim()) qs.set("q", text.trim()); // add the search text if there is any
    const str = qs.toString(); // turn it into text
    // replace (not push) so every letter typed doesn't add a Back step; scroll: false = stay where you are
    startTransition(() => router.replace(str ? `/dashboard/customers?${str}` : "/dashboard/customers", { scroll: false }));
  }

  // runs on every key press
  function onChange(text: string) {
    setValue(text); // show the new text in the box right away
    if (timer.current) clearTimeout(timer.current); // cancel the previous wait
    timer.current = setTimeout(() => go(text), 300); // search 300ms after the last key
  }

  return (
    // role="search" tells screen readers this is a search area
    <form
      role="search"
      className="relative w-full max-w-sm"
      onSubmit={(e) => {
        e.preventDefault(); // stop the normal page reload
        if (timer.current) clearTimeout(timer.current); // Enter = search now, no waiting
        go(value);
      }}
    >
      {/* label for screen readers (hidden on screen) */}
      <label htmlFor="customer-search" className="sr-only">
        Search customers by name, mobile number or ID number
      </label>
      {/* magnifying glass icon inside the box, on the left */}
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      {/* the text box itself; pr-24 leaves room for "Searching" and the clear button on the right */}
      <input
        id="customer-search"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by name, mobile or ID number"
        autoComplete="off"
        className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-24 text-sm placeholder:text-slate-500 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {/* right side of the box: loading text + clear button */}
      <span className="absolute inset-y-0 right-2 flex items-center gap-1">
        {/* aria-live = screen readers hear "Searching" while the list loads */}
        <span aria-live="polite" className="text-xs text-slate-500">
          {pending ? "Searching" : ""}
        </span>
        {/* the X clear button, only when something is typed */}
        {value && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              if (timer.current) clearTimeout(timer.current); // cancel any waiting search
              setValue(""); // empty the box
              go(""); // show the full list again
            }}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <Icon name="x" className="h-3.5 w-3.5" />
          </button>
        )}
      {/* end of the right side */}
      </span>
    </form>
  );
}