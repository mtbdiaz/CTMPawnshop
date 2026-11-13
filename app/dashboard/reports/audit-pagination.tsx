import Link from "next/link";
import { buttonClasses, cx } from "@/components/ui";
import { pageWindow } from "@/lib/reports/report-utils";

// AT8 (Nov 13): paging for thousands of audit entries.
// Before: only Previous and Next (the shared Pagination), so reaching an entry on page 600 of 1,139 meant hundreds of clicks.
// Now: First, Previous, page numbers around the open page, Next, Last, and "Go to page". Every link and the form
// keep the filters and the search (they're all in the address), and the database still does the paging.
export function AuditPagination({ page, pageSize, total, params }: { page: number; pageSize: number; total: number; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const fmt = (n: number) => n.toLocaleString("en-PH");
  const kept = Object.entries(params).filter(([, v]) => v) as [string, string][]; // the filters to keep
  const href = (p: number) => {
    const q = new URLSearchParams(kept);
    if (p > 1) q.set("page", String(p));
    return `/dashboard/reports?${q.toString()}`;
  };
  const step = "inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-2.5 text-sm font-medium";
  const link = (p: number, label: string, aria: string) =>
    p === page || p < 1 || p > pages ? (
      <span className={cx(step, "border-slate-200 text-slate-400")} aria-disabled="true">
        {label}
      </span>
    ) : (
      <Link href={href(p)} aria-label={aria} className={cx(step, "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500")}>
        {label}
      </Link>
    );

  return (
    <nav aria-label="Audit trail pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600 print:hidden">
      <p aria-live="polite">
        Showing <span className="font-medium text-slate-900">{fmt(from)}</span>–<span className="font-medium text-slate-900">{fmt(to)}</span> of{" "}
        <span className="font-medium text-slate-900">{fmt(total)}</span>
      </p>
      {pages > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {link(1, "«", "First page")}
          {link(page - 1, "‹ Previous", "Previous page")}
          {/* page numbers: hidden on a phone, where First/Previous/Next/Last and Go to page are enough */}
          <span className="hidden items-center gap-1.5 md:flex">
            {pageWindow(page, pages).map((p, i) =>
              p === "gap" ? (
                <span key={`gap${i}`} className="px-1 text-slate-400" aria-hidden="true">
                  …
                </span>
              ) : p === page ? (
                <span key={p} aria-current="page" className={cx(step, "border-navy-800 bg-navy-800 text-white")}>
                  {fmt(p)}
                </span>
              ) : (
                <Link key={p} href={href(p)} aria-label={`Page ${fmt(p)}`} className={cx(step, "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500")}>
                  {fmt(p)}
                </Link>
              ),
            )}
          </span>
          {link(page + 1, "Next ›", "Next page")}
          {link(pages, "»", "Last page")}
          {/* jump straight to a page; the hidden fields keep the filters */}
          <form action="/dashboard/reports" className="ml-1 flex items-center gap-1.5">
            {kept.map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <label htmlFor="audit-page" className="whitespace-nowrap">
              Go to page
            </label>
            <input
              id="audit-page"
              name="page"
              type="number"
              min={1}
              max={pages}
              defaultValue={page}
              className="h-9 w-20 rounded-md border border-slate-300 px-2 text-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20"
            />
            <span className="whitespace-nowrap">of {fmt(pages)}</span>
            <button type="submit" className={buttonClasses("secondary", "sm")}>
              Go
            </button>
          </form>
        </div>
      )}
    </nav>
  );
}
