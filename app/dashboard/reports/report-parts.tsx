import { PRINT_LIMIT, REPORT_PAGE_SIZE } from "@/lib/reports/report-utils";
import { cx } from "@/components/ui";

// RP3: small pieces shared by the reports.

/** Rows per request: 50 normally, up to 1,000 when "Show all on one page (for printing)" is on. */
export function pageSizeFor(all: boolean) {
  return all ? PRINT_LIMIT : REPORT_PAGE_SIZE;
}

// "Show all on one page" so the whole list can be printed; only shown when there is more than one page.
// RP9: one request holds at most 1,000 rows, so a bigger list prints 1,000 a page (the pages below still work).
// OL7 (Nov 13): pageSize = the report's normal page size (Outstanding loans uses 10; the others still 50).
export function ShowAllLink({ all, total, href, pageSize = REPORT_PAGE_SIZE }: { all: boolean; total: number; href: string; pageSize?: number }) {
  if (total <= pageSize) return null;
  const label = all
    ? `Show ${pageSize} per page`
    : total <= PRINT_LIMIT
      ? `Show all ${total.toLocaleString("en-PH")} on one page (for printing)`
      : `Show ${PRINT_LIMIT.toLocaleString("en-PH")} per page (for printing)`;
  return (
    <p className="border-t border-slate-200 px-4 py-2.5 text-sm print:hidden">
      <a href={href} className="font-medium text-navy-700 hover:underline">
        {label}
      </a>
    </p>
  );
}

// the address of a report with some filters changed (empty values are left out, the page goes back to 1)
export function reportHref(base: string, current: Record<string, string | undefined>, change: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, page: undefined, all: undefined, ...change })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

// RP11 (Nov 13): says on paper when a printout holds only part of the list.
// Before: the page numbers are hidden when printing, so printing page 1 of 305 loans gave 50 rows with nothing on the
// paper saying the rest were missing (only the Total row said "all 305").
// Now: "Limited print view: rows 1–50 of 305 (page 1 of 7)" is printed whenever the list doesn't fit on this page.
// On screen it shows only when even 1,000 rows per page can't hold everything (the screen already has page numbers).
export function PrintScope({ page, size, total, shown, all, totalRow = true, advice }: { page: number; size: number; total: number; shown: number; all: boolean; totalRow?: boolean; advice?: string }) {
  if (total <= shown) return null; // every matching row is on this page: the printout is complete
  const from = (page - 1) * size + 1;
  const pages = Math.ceil(total / size);
  const fmt = (n: number) => n.toLocaleString("en-PH");
  const howToGetAll =
    advice ??
    (total <= PRINT_LIMIT ? "To print every row, use “Show all on one page (for printing)”." : `One printout holds at most ${fmt(PRINT_LIMIT)} rows: print each page to get every row.`);
  return (
    <p className={cx("border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900", !(all && total > PRINT_LIMIT) && "hidden print:block")}>
      <strong>Limited print view:</strong> rows {fmt(from)}–{fmt(from + shown - 1)} of {fmt(total)} (page {fmt(page)} of {fmt(pages)}).{" "}
      {totalRow && `The Total row covers all ${fmt(total)}. `}
      {howToGetAll}
    </p>
  );
}
