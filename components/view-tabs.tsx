import Link from "next/link"; // a normal link that opens the tab without a full reload
import type { ReactNode } from "react"; // anything React can show (the left side of the toolbar row)
import { cx } from "@/components/ui"; // joins class names, skipping empty ones
import { MoreViews } from "@/components/more-views"; // the "More …" dropdown at the end of the row

// D1: ONE tab style for every page (the Loans style): tabs in a row with a navy line under the selected one,
// small grey counts, an optional amber or red dot, and an optional "More …" dropdown for the rest.
// The tabs are links, so each tab has its own address (Back works, and a link to a tab can be shared).

export type ViewTab = {
  value: string; // the tab's id (compared with `current`)
  label: string; // the name on the tab
  href: string; // where the tab goes
  count?: number; // optional number after the name
  tone?: "warning" | "danger"; // optional dot: amber = needs attention, red = serious. Only shows when count > 0
};

export function ViewTabs({
  label, // what screen readers call this row, e.g. "Loan views"
  tabs, // the tabs always shown in the row
  current, // the tab that is open now
  more, // optional: extra tabs in a "More …" dropdown at the end
}: {
  label: string;
  tabs: ViewTab[];
  current: string;
  more?: { label?: string; options: Omit<ViewTab, "tone">[] };
}) {
  return (
    // nav = a group of links; the grey line under the row is the bottom border; wraps on small screens
    <nav aria-label={label} className="flex flex-wrap items-center gap-x-1 border-b border-slate-200 px-2 print:hidden">
      {tabs.map((t) => {
        const active = t.value === current; // is this the open tab?
        const dot = t.tone === "danger" ? "bg-red-600" : t.tone === "warning" ? "bg-amber-500" : null; // the dot color, if any
        return (
          <Link
            key={t.value}
            href={t.href}
            aria-current={active ? "page" : undefined} // screen readers say "current page" on the open tab
            className={cx(
              // -mb-px = the navy line sits on top of the grey line under the row
              "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-500",
              // open tab = navy line + bold; others = no line, grey line on hover
              active ? "border-navy-700 font-semibold text-navy-900" : "border-transparent font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900",
            )}
          >
            {/* the dot only shows when there is something in that tab; the word says it too, so color is never the only signal */}
            {dot && (t.count ?? 0) > 0 && <span aria-hidden="true" className={cx("h-1.5 w-1.5 rounded-full", dot)} />}
            {t.label}
            {/* the count, small and grey, when the page gives one */}
            {t.count !== undefined && <span className="text-xs font-normal tabular-nums text-slate-500">{t.count.toLocaleString("en-PH")}</span>}
          </Link>
        );
      })}
      {/* the "More …" dropdown, only when the page has extra tabs */}
      {more && more.options.length > 0 && <MoreViews label={more.label} current={current} options={more.options} />}
    </nav>
  );
}

// D1: the row under the tabs: search and other filters on the left, and on the right which tab is showing
// ("Viewing: Open") or, while searching, how many the search found in it ("3 matches in Open").
export function ViewToolbar({
  children, // the search box and any other filters (left side)
  viewing, // the name of the open tab
  matches, // a number = the search is on and found this many; undefined = not searching
}: {
  children?: ReactNode;
  viewing: string;
  matches?: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-200 px-4 py-3 print:hidden">
      {/* left: search and filters (they wrap under each other on small screens).
          w-full on phones = it takes the whole row, so the search box isn't squeezed and "Viewing" goes to the next line;
          from 640px (sm) it shares the row with "Viewing" */}
      {/* only when the page has search or filters (Suspicious activity and Archive have none, so no empty gap on phones) */}
      {children && <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-1">{children}</div>}
      {/* right: what is showing. aria-live = screen readers hear it when it changes */}
      {/* ml-auto = always on the right, even when there's nothing on the left (Suspicious activity, Archive) */}
      <p aria-live="polite" className="ml-auto text-sm text-slate-600">
        {matches !== undefined ? (
          <>
            {matches.toLocaleString("en-PH")} match{matches === 1 ? "" : "es"} in <span className="font-medium text-slate-800">{viewing}</span>
          </>
        ) : (
          <>
            Viewing: <span className="font-medium text-slate-800">{viewing}</span>
          </>
        )}
      </p>
    </div>
  );
}
