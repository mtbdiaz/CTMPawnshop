"use client"; // runs in the browser: a dropdown or date that is changed opens the filtered list right away

import Link from "next/link";
import { Icon } from "@/components/icons";
import { ENTRY_TYPES, hasFilters, type LedgerFilters } from "@/lib/finance/ledger";

const control = "w-full min-w-0 rounded-md border border-slate-300 bg-white py-2 pl-2.5 pr-8 text-sm text-slate-800 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20";

// CL1 (Nov 12): search and filters for the ledger. It is a plain form that goes to the same page with the choices
// in the address (?q=...&type=...), so the search runs in the database, Back works, the page number starts at 1
// again, and the filtered list can be bookmarked. Changing a dropdown or a date sends the form by itself; the
// search box sends on Enter.
export function LedgerFiltersBar({ filters }: { filters: LedgerFilters }) {
  const send = (e: { currentTarget: { form: HTMLFormElement | null } }) => e.currentTarget.form?.requestSubmit();
  return (
    <form action="/dashboard/finance" role="search" className="space-y-2 border-b border-slate-200 px-4 py-3 print:hidden">
      {filters.check && <input type="hidden" name="check" value="1" />}
      {/* FC1: two tidy rows. Row 1: the search box with its button. Row 2: the five filters in equal columns
          (five across on a laptop, three on a tablet, two on a phone), so nothing is left alone on a line */}
      {/* CL2: a label you can see (before, it was only read out by screen readers) */}
      <label htmlFor="ledger-q" className="block text-xs text-slate-600">
        Search transactions
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-64">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="ledger-q"
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Search ticket, receipt number, description or customer"
            className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-500 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20"
          />
        </div>
        <button type="submit" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
          Search
        </button>
        {hasFilters(filters) && (
          <Link href="/dashboard/finance" className="px-1 py-2 text-sm font-medium text-navy-700 hover:underline">
            Clear filters
          </Link>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-600">
          Type
          <select name="type" defaultValue={filters.type} onChange={send} className={control}>
            <option value="">All types</option>
            {ENTRY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-600">
          Movement
          <select name="flow" defaultValue={filters.flow} onChange={send} className={control}>
            <option value="">All movements</option>
            <option value="in">Cash in</option>
            <option value="out">Cash out</option>
            <option value="noncash">Non-cash</option>
          </select>
        </label>
        {/* where the entry came from: typed in by staff, or made by a loan, payment or sale */}
        <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-600">
          Entry source
          <select name="source" defaultValue={filters.source} onChange={send} className={control}>
            <option value="">All sources</option>
            <option value="manual">Manual entry (by staff)</option>
            <option value="system">System (loan, payment, sale)</option>
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-600">
          From date
          <input type="date" name="from" defaultValue={filters.from} onChange={send} className={control.replace("pr-8", "pr-2.5")} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-600">
          To date
          <input type="date" name="to" defaultValue={filters.to} onChange={send} className={control.replace("pr-8", "pr-2.5")} />
        </label>
      </div>
    </form>
  );
}
