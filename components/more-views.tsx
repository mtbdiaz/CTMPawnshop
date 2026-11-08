"use client"; // runs in the browser: switching the view when an option is picked

import { useRouter } from "next/navigation"; // changes the page address without a full reload
import { cx } from "@/components/ui"; // joins class names, skipping empty ones

// L32 + D1: the "More …" dropdown at the end of a tab row (moved here from the Loans folder so every page can use it).
// Loans: More views (Reinstated, Redeemed, Forfeited). Archive: More types.
// It's the browser's own <select>, so it works with the keyboard, on phones and with screen readers.
// When one of its choices is open, the box shows that choice's name with a navy outline, so the current view is never unclear.
export function MoreViews({
  label = "More views", // the words shown in the box when none of its choices is open (and read by screen readers)
  options, // the choices: value = the tab's id, label = its name, count = optional number, href = where it goes
  current, // the tab that is open now
}: {
  label?: string;
  options: { value: string; label: string; count?: number; href: string }[];
  current: string;
}) {
  const router = useRouter(); // used to open the picked choice
  const active = options.some((o) => o.value === current); // is one of these choices the one being shown?
  return (
    <label className="my-1.5 ml-2 inline-flex items-center">
      {/* the name of the box for screen readers (the placeholder text says it on screen) */}
      <span className="sr-only">{label}</span>
      <select
        value={active ? current : ""} // shows the open choice, or the placeholder when none is open
        onChange={(e) => {
          const picked = options.find((o) => o.value === e.target.value); // the choice that was picked
          if (picked) router.push(picked.href); // open it (a normal page change: search and sort stay as they are)
        }}
        aria-current={active ? "page" : undefined} // tells screen readers this box holds the open view
        className={cx(
          "cursor-pointer rounded-md border bg-white py-1.5 pl-3 pr-8 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500",
          // open choice = navy outline and bold, like a selected tab; otherwise a plain grey box
          active ? "border-navy-700 font-semibold text-navy-900 ring-1 ring-navy-700" : "border-slate-300 font-medium text-slate-600 hover:border-slate-400",
        )}
      >
        {/* shown when none of these choices is open; it can't be picked */}
        <option value="" disabled>
          {label}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {/* the name, plus the count in brackets when there is one */}
            {o.label}
            {o.count !== undefined ? ` (${o.count.toLocaleString("en-PH")})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
