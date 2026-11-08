"use client"; // runs in the browser: it opens the picked option right away

import { useRouter } from "next/navigation"; // changes the page address without a full reload

// D2: a labelled dropdown that opens a page when you pick an option, e.g. Inventory's "Category".
// Same look as the Appraisals Category dropdown, so both pages match.
// Each option carries its own address, worked out on the server, so the other filters (status tab) stay as they are.
export function NavSelect({
  label, // the word shown before the box, e.g. "Category" (also how screen readers name it)
  value, // the option that is open now
  options, // value = id, label = what is shown, href = where it goes
}: {
  label: string;
  value: string;
  options: { value: string; label: string; href: string }[];
}) {
  const router = useRouter(); // used to open the picked option
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      {/* the visible label; the select inside the same <label> is named by it */}
      <span className="whitespace-nowrap">{label}</span>
      <select
        value={value} // shows the open option
        onChange={(e) => {
          const picked = options.find((o) => o.value === e.target.value); // the option that was picked
          if (picked) router.push(picked.href); // open it
        }}
        className="rounded-md border border-slate-300 bg-white py-2 pl-2.5 pr-8 text-sm text-slate-800 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
