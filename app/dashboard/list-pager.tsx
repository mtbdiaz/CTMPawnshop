// Link = Next.js's clickable link (no full page reload)
import Link from "next/link";
// buttonClasses = the same button look used everywhere; cx = joins class names
import { buttonClasses, cx } from "@/components/ui";

// Footer under a Dashboard list: "Showing 6–10 of 111", Previous / Page 2 of 23 / Next, and See all.
// It is a server component: the page number lives in the address (?na=2), so each list keeps its own page.
export function ListPager({
  label, // what the list is called, for screen readers ("Needs attention")
  page, // the page being shown (starts at 1)
  totalPages, // how many pages there are
  total, // how many records in the whole list
  pageSize, // rows per page (5)
  hrefFor, // makes the address for a given page number
  seeAllHref, // where "See all" goes
  seeAllLabel, // the words on the See all button
}: {
  label: string;
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  hrefFor: (page: number) => string;
  seeAllHref: string;
  seeAllLabel: string;
}) {
  const first = (page - 1) * pageSize + 1; // number of the first row on this page (6 on page 2)
  const last = Math.min(page * pageSize, total); // number of the last row on this page (10, or fewer on the last page)
  const prevOff = page <= 1; // no Previous on the first page
  const nextOff = page >= totalPages; // no Next on the last page
  // the look of a small secondary button
  const btn = buttonClasses("secondary", "sm");
  // the look of a greyed-out button that can't be clicked
  const off = cx(btn, "pointer-events-none opacity-50");

  return (
    // the footer bar: wraps onto two lines on narrow screens; py-2 keeps it slim
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-slate-200 px-4 py-2 text-sm text-slate-600">
      {/* left: which rows are showing */}
      <span className="tabular-nums">
        Showing {first}–{last} of {total}
      </span>
      {/* right: page buttons + See all */}
      <div className="flex flex-wrap items-center gap-2">
        {/* only show the page buttons when there is more than one page */}
        {totalPages > 1 && (
          // nav = a group of navigation links; aria-label says which list it controls
          <nav aria-label={`${label} pages`} className="flex items-center gap-2">
            {/* Previous: a real link, or a greyed-out label on page 1 */}
            {prevOff ? (
              <span className={off} aria-disabled="true">
                Previous
              </span>
            ) : (
              // scroll={false} = stay where you are on the page instead of jumping to the top
              <Link href={hrefFor(page - 1)} scroll={false} className={btn}>
                Previous
              </Link>
            )}
            {/* the page indicator */}
            <span className="whitespace-nowrap tabular-nums" aria-current="page">
              Page {page} of {totalPages}
            </span>
            {/* Next: a real link, or a greyed-out label on the last page */}
            {nextOff ? (
              <span className={off} aria-disabled="true">
                Next
              </span>
            ) : (
              <Link href={hrefFor(page + 1)} scroll={false} className={btn}>
                Next
              </Link>
            )}
          {/* end of the page buttons */}
          </nav>
        )}
        {/* See all: opens the full list on the Loans page */}
        {/* navy text link so it stands apart from the grey page buttons */}
        <Link href={seeAllHref} className="whitespace-nowrap px-1 font-medium text-navy-700 underline-offset-2 hover:underline">
          {seeAllLabel} →
        </Link>
      {/* end of the right side */}
      </div>
    {/* end of the footer bar */}
    </div>
  );
}