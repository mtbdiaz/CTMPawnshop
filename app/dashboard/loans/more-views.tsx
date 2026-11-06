"use client"; // runs in the browser: switching the view when an option is picked

import { useRouter } from "next/navigation";
import { cx } from "@/components/ui";

// L32: the "More views" dropdown on the Loans toolbar (Reinstated, Redeemed, Forfeited).
// It's the browser's own <select>, so it works with the keyboard, on phones and with screen readers.
// When one of its views is open, the box shows that view's name with a navy outline, so the current view is never unclear.
export function MoreViews({ options, current }: { options: { value: string; label: string; count: number; href: string }[]; current: string }) {
  const router = useRouter();
  const active = options.some((o) => o.value === current); // is one of these views the one being shown?
  return (
    <label className="my-1.5 ml-2 inline-flex items-center">
      <span className="sr-only">More views</span>
      <select
        value={active ? current : ""}
        onChange={(e) => {
          const picked = options.find((o) => o.value === e.target.value);
          if (picked) router.push(picked.href); // open that view (a normal page change: search and sort stay as they are)
        }}
        aria-current={active ? "page" : undefined}
        className={cx(
          "cursor-pointer rounded-md border bg-white py-1.5 pl-3 pr-8 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500",
          active ? "border-navy-700 font-semibold text-navy-900 ring-1 ring-navy-700" : "border-slate-300 font-medium text-slate-600 hover:border-slate-400",
        )}
      >
        {/* shown when none of these views is open; it can't be picked */}
        <option value="" disabled>
          More views
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} ({o.count.toLocaleString("en-PH")})
          </option>
        ))}
      </select>
    </label>
  );
}
