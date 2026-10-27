// "use client" = this part runs in the browser, because it reacts to every key you type
"use client";

// useState = remembers values; useEffect = runs code when something changes;
// useRef = remembers a value (or an element) without redrawing; useId = unique ids
import { useEffect, useId, useRef, useState } from "react";
// useRouter = lets the code open another page (Enter on a result)
import { useRouter } from "next/navigation";
// Link = Next.js's clickable link
import Link from "next/link";
// the server function that finds matching records, and the shape of its answer
import { quickSearch, type SearchHit, type SearchResults } from "./search-actions";
// cx joins class names; buttonClasses = shared button look; StatusBadge = the app's status badges
import { buttonClasses, cx, StatusBadge } from "@/components/ui";
// the small line icons used in the sidebar
import { Icon } from "@/components/icons";

// The 4 groups, in the order they are shown, with the same icons as the sidebar
const GROUPS = [
  { key: "customers", title: "Customers", icon: "users" },
  { key: "loans", title: "Loans", icon: "ticket" },
  { key: "appraisals", title: "Appraisals", icon: "scale" },
  { key: "payments", title: "Payments", icon: "cash" },
] as const;

// Smart search on the Dashboard: type 2+ characters and matching customers, loans,
// appraisals and payments appear under the box, grouped. Click one (or arrows + Enter) to open it.
// Ctrl+K (Cmd+K on Mac) jumps to the box. The Search button opens all matching loans.
export function QuickSearch() {
  const [q, setQ] = useState(""); // what is typed
  const [results, setResults] = useState<SearchResults | null>(null); // the latest answer
  const [searched, setSearched] = useState(""); // which text that answer belongs to
  const [loading, setLoading] = useState(false); // waiting for the server?
  const [failed, setFailed] = useState(false); // did the last search fail?
  const [active, setActive] = useState(-1); // highlighted row (-1 = none)
  const [open, setOpen] = useState(false); // is the preview showing?
  const router = useRouter(); // opens pages from code
  const listId = useId(); // unique id for the list (screen readers)
  const inputRef = useRef<HTMLInputElement>(null); // the text box itself (for Ctrl+K and Clear)
  const seq = useRef(0); // search counter, so an old slow answer can't replace a newer one

  const term = q.trim().replace(/\s+/g, " "); // the text without extra spaces

  // Ctrl+K / Cmd+K anywhere on the page puts the cursor in the search box
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); // stop the browser's own Ctrl+K
        inputRef.current?.focus(); // jump to the box
        inputRef.current?.select(); // select the old text so you can type over it
      }
    }
    window.addEventListener("keydown", onKey); // start listening
    return () => window.removeEventListener("keydown", onKey); // stop when the page closes
  }, []);

  // Runs every time the text changes: wait 250 ms, then ask the server
  useEffect(() => {
    if (term.length < 2) return; // need at least 2 characters
    const mine = ++seq.current; // this search's number
    const t = setTimeout(async () => {
      setLoading(true); // show "Searching"
      try {
        const res = await quickSearch(term); // ask the server
        if (mine !== seq.current) return; // a newer search started: ignore this answer
        setResults(res); // show the answer
        setSearched(term); // remember which text it belongs to
        setFailed(false); // no error
        setActive(-1); // nothing highlighted yet
      } catch {
        if (mine !== seq.current) return;
        setFailed(true); // show the friendly error (no technical details)
      } finally {
        if (mine === seq.current) setLoading(false); // hide "Searching"
      }
    }, 250);
    return () => clearTimeout(t); // a new key came before 250 ms: cancel this wait
  }, [term]);

  // the groups that have results for the CURRENT text (empty groups are skipped)
  const nonEmpty = results && searched === term && term.length >= 2 ? GROUPS.map((g) => ({ ...g, hits: results[g.key] })).filter((g) => g.hits.length) : [];
  // start = the row number of each group's first row in the whole list (for the arrow keys)
  const groups = nonEmpty.map((g, gi) => ({ ...g, start: nonEmpty.slice(0, gi).reduce((n, x) => n + x.hits.length, 0) }));
  // all rows in one list, in display order, for the arrow keys
  const flat: SearchHit[] = groups.flatMap((g) => g.hits);
  // the address of the full results (Loans page, all statuses)
  const allHref = `/dashboard/loans?status=all&q=${encodeURIComponent(term)}`;
  // show the preview box?
  const show = open && term.length >= 2;

  // empties the box and puts the cursor back in it
  function clear() {
    setQ("");
    setResults(null);
    setActive(-1);
    inputRef.current?.focus();
  }

  // Keyboard inside the box: arrows move, Enter opens the highlighted row, Escape closes
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false); // hide the preview
      return;
    }
    if (!flat.length) return; // nothing to move through
    if (e.key === "ArrowDown") {
      e.preventDefault(); // keep the cursor where it is
      setOpen(true);
      setActive((a) => (a + 1) % flat.length); // next row (wraps to the top)
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a <= 0 ? flat.length - 1 : a - 1)); // previous row (wraps to the bottom)
    } else if (e.key === "Enter" && open && active >= 0) {
      e.preventDefault(); // don't submit the form
      router.push(flat[active].href); // open the highlighted record
    }
    // Enter with nothing highlighted = the form submits = all matching loans
  }

  // opens a row with the mouse (onMouseDown runs before the box loses focus)
  function pick(e: React.MouseEvent, href: string) {
    e.preventDefault();
    router.push(href);
  }

  return (
    // Search button / Enter (nothing highlighted) open the Loans page with ?q=...
    <form action="/dashboard/loans" role="search" className="flex w-full gap-2 sm:w-auto print:hidden">
      {/* search ALL loans on the Loans page, not only open ones */}
      <input type="hidden" name="status" value="all" />
      {/* the box + the preview under it (relative = the preview is placed against this) */}
      <div className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
        {/* label for screen readers only */}
        <label htmlFor="dashboard-search" className="sr-only">
          Search tickets, customers, items and receipts
        </label>
        {/* magnifying glass (decoration) */}
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        {/* the text box; role="combobox" tells screen readers a list of choices appears under it */}
        <input
          ref={inputRef}
          id="dashboard-search"
          type="text"
          name="q"
          role="combobox"
          aria-expanded={show}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && flat.length ? `${listId}-${active}` : undefined}
          autoComplete="off"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder="Search tickets, customers, items..."
          className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-16 text-sm placeholder:text-slate-500 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20"
        />
        {/* right side of the box: the Clear (x) button when there is text, otherwise a Ctrl K hint */}
        {q ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()} // keep focus in the box
            onClick={clear}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-slate-300 px-1.5 text-xs text-slate-500 sm:block">Ctrl K</kbd>
        )}

        {/* THE PREVIEW: floats under the box (z-20 = above the cards; shadow because it floats, like dialogs) */}
        {show && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg sm:left-auto sm:w-[28rem]">
            {/* screen readers hear how many results there are */}
            <p className="sr-only" aria-live="polite">
              {loading ? "Searching" : `${flat.length} result${flat.length === 1 ? "" : "s"}`}
            </p>
            {/* waiting for the answer (only when nothing is shown yet) */}
            {loading && !groups.length && (
              <p className="flex items-center gap-2 px-3 py-3 text-sm text-slate-500">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
                Searching
              </p>
            )}
            {/* the search failed: friendly message, no technical details */}
            {failed && !loading && <p className="px-3 py-3 text-sm text-red-700">Unable to load search results. Please try again.</p>}
            {/* nothing found */}
            {!loading && !failed && searched === term && !groups.length && (
              <div className="px-3 py-3 text-sm">
                <p className="text-slate-700">No matching records found.</p>
                <p className="mt-0.5 text-slate-500">Try a ticket number, a name, a phone number or an item like &quot;ring 18k&quot;.</p>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={clear} className={cx(buttonClasses("secondary", "sm"), "mt-2")}>
                  Clear search
                </button>
              </div>
            )}
            {/* the grouped results */}
            {groups.length > 0 && (
              <ul id={listId} role="listbox" aria-label="Search results" className="max-h-[26rem] overflow-y-auto">
                {groups.map((g) => (
                  // one group: a small heading, then its rows
                  <li key={g.key} role="presentation">
                    {/* group heading with the sidebar icon */}
                    <p className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <Icon name={g.icon} className="h-3.5 w-3.5" />
                      {g.title}
                    </p>
                    <ul role="presentation" className="divide-y divide-slate-100">
                      {g.hits.map((h, hi) => {
                        const i = g.start + hi; // this row's number in the whole list
                        return (
                          <li key={`${g.key}-${h.id}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                            {/* the whole row opens the record */}
                            <Link
                              href={h.href}
                              onMouseDown={(e) => pick(e, h.href)}
                              onMouseEnter={() => setActive(i)}
                              // phones: text on top, badge + action under it; bigger screens: side by side
                              className={cx("flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:py-2", i === active ? "bg-navy-50" : "hover:bg-slate-50")}
                            >
                              {/* left: main text + small text */}
                              <span className="min-w-0">
                                {/* break-all on phones so long ticket numbers wrap; one line (truncate) on bigger screens */}
                                <span className={cx("block break-all text-sm font-medium text-slate-900 sm:truncate", (g.key === "loans" || g.key === "payments") && "font-mono")}>{h.title}</span>
                                <span className="block text-xs text-slate-500 sm:truncate">{h.subtitle}</span>
                              </span>
                              {/* right: status badge (words, not just colour) + what opening it does */}
                              <span className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
                                {h.badge && <StatusBadge status={h.badge.status} label={h.badge.label} />}
                                <span className="whitespace-nowrap text-xs font-medium text-navy-700">{h.action} →</span>
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            {/* bottom: all matching loans on the Loans page */}
            <Link
              href={allHref}
              onMouseDown={(e) => pick(e, allHref)}
              className="block border-t border-slate-200 px-3 py-2 text-sm font-medium text-navy-800 hover:bg-slate-50"
            >
              View all matching loans →
            </Link>
          </div>
        )}
      {/* end of the box + preview */}
      </div>
      {/* the visible Search button (no need to know about pressing Enter) */}
      <button type="submit" className={buttonClasses("secondary")}>
        Search
      </button>
    </form>
  );
}