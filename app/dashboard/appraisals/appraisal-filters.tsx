"use client"; // runs in the browser: it reacts to typing and to the dropdown

// useRef = remembers the timer between key presses; useState = the text in the box; useTransition = "is the list loading?"
import { useRef, useState, useTransition } from "react";
// useRouter = changes the page address without a full reload
import { useRouter } from "next/navigation";
// Icon = the small line icons used across the app
import { Icon } from "@/components/icons";
// the item categories the system supports (Earrings, Ring, ...)
import { ITEM_CATEGORIES } from "@/lib/appraisal/valuation";

// B4 + B6: search while typing (300ms after the last key) and one Category dropdown instead of 8 buttons.
// Both keep the tab and sort, and go back to page 1. Same behavior as the Customers search.
export function AppraisalFilters({
  defaultQuery, // the search already in the address (e.g. after pressing Back)
  category, // the category already chosen, or "" for all
  keep, // the other things in the address to keep (tab, sort, direction)
}: {
  defaultQuery?: string;
  category: string;
  keep: Record<string, string | undefined>;
}) {
  const router = useRouter(); // used to change the address
  const [value, setValue] = useState(defaultQuery ?? ""); // what is typed in the box
  const [pending, startTransition] = useTransition(); // pending = true while the new list loads
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null); // the 300ms wait timer

  // builds the address for a search + category and opens it
  function go(text: string, cat: string) {
    const qs = new URLSearchParams(); // the "?a=1&b=2" part
    for (const [k, v] of Object.entries(keep)) if (v) qs.set(k, v); // keep the tab and sort
    if (text.trim()) qs.set("q", text.trim()); // the search text, if any
    if (cat) qs.set("category", cat); // the category, if one is chosen
    const str = qs.toString();
    // replace (not push) so every letter typed doesn't add a Back step; scroll: false = stay where you are
    startTransition(() => router.replace(str ? `/dashboard/appraisals?${str}` : "/dashboard/appraisals", { scroll: false }));
  }

  // runs on every key press
  function onChange(text: string) {
    setValue(text); // show the new text in the box right away
    if (timer.current) clearTimeout(timer.current); // cancel the previous wait
    timer.current = setTimeout(() => go(text, category), 300); // search 300ms after the last key
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      {/* role="search" tells screen readers this is a search area */}
      <form
        role="search"
        className="relative w-full sm:w-80"
        onSubmit={(e) => {
          e.preventDefault(); // stop the normal page reload
          if (timer.current) clearTimeout(timer.current); // Enter = search now, no waiting
          go(value, category);
        }}
      >
        <label htmlFor="appraisal-search" className="sr-only">
          Search appraisals by item, karat or notes
        </label>
        {/* magnifying glass inside the box */}
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          id="appraisal-search"
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search item, karat or notes"
          autoComplete="off"
          maxLength={60}
          className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-24 text-sm placeholder:text-slate-500 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20 [&::-webkit-search-cancel-button]:hidden"
        />
        {/* right side of the box: loading text + clear button */}
        <span className="absolute inset-y-0 right-2 flex items-center gap-1">
          <span aria-live="polite" className="text-xs text-slate-500">
            {pending ? "Searching" : ""}
          </span>
          {value && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                if (timer.current) clearTimeout(timer.current); // cancel any waiting search
                setValue(""); // empty the box
                go("", category); // show the full list again
              }}
              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </form>
      {/* B6: one dropdown for the category. It changes the list right away */}
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <span className="whitespace-nowrap">Category</span>
        <select
          value={category}
          onChange={(e) => go(value, e.target.value)}
          className="rounded-md border border-slate-300 bg-white py-2 pl-2.5 pr-8 text-sm text-slate-800 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20"
        >
          <option value="">All categories</option>
          {ITEM_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
