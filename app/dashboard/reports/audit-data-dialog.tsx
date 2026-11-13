"use client"; // runs in the browser: it opens a popup

import { useEffect, useRef, useState } from "react";
import { buttonClasses, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { FieldRow } from "@/lib/audit/changes";

// AT2 (Matt, Nov 11): "View data" opened inside the table row, so the row became very tall and the When, Record
// and By columns moved down out of sight. Now it opens a popup on the same page: one line per field with
// Before and After, changed fields marked and listed first. The raw data is still there, folded, for developers.
// AT7 (Nov 13): the button says what it opens ("View changes" when there is a before and after, otherwise
// "View details"), and the popup shows the readable reference (PT-…, C-0012) and the full record ID.
export function AuditDataButton({
  label = "View details",
  title,
  subtitle,
  record,
  reason,
  rows,
  raw,
}: {
  label?: "View changes" | "View details";
  title: string; // "Loan status updated"
  subtitle: string; // "Nov 13, 2026, 12:05 AM · System / service"
  record: { ref: string; id: string }; // "PT-2026…-829B" and the record's full ID
  reason?: string; // why: an Admin correction's reason, an ID view's reason
  rows: FieldRow[]; // from allFields()
  raw: { before: unknown; after: unknown }; // the stored rows, for the folded raw data
}) {
  const ref = useRef<HTMLDialogElement>(null); // the <dialog>
  const [open, setOpen] = useState(false); // true while the popup shows
  const hasBefore = rows.some((r) => r.before !== null); // an update with the old row saved
  const changedCount = rows.filter((r) => r.changed).length;
  const [onlyChanged, setOnlyChanged] = useState(false); // "Show only changed fields"
  // changed fields first, then the rest in their usual order
  const sorted = [...rows.filter((r) => r.changed), ...rows.filter((r) => !r.changed)];
  const shown = onlyChanged ? sorted.filter((r) => r.changed) : sorted;

  useEffect(() => {
    if (open) ref.current?.showModal(); // on top of the page; the page behind can't be clicked
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cx(buttonClasses("secondary", "sm"), "focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500")}>
        {label}
      </button>
      {open && (
        <dialog
          ref={ref}
          aria-labelledby="audit-data-title"
          onClose={() => setOpen(false)}
          onClick={(e) => e.target === e.currentTarget && ref.current?.close()} // a click on the dark area closes it
          className="m-auto max-h-[calc(100dvh-2rem)] w-[min(56rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-slate-200 p-0 shadow-2xl backdrop:bg-navy-950/50 backdrop:backdrop-blur-sm"
        >
          <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
            {/* header: what this entry is, and the X */}
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <h2 id="audit-data-title" className="text-lg font-semibold text-slate-900">
                  {title}
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
                {/* WHICH record: the reference people use, and the full record ID (select-all, for searching) */}
                <p className="mt-1 text-sm text-slate-700">
                  {record.ref && <span className="font-medium">{record.ref} · </span>}
                  Record ID <span className="select-all break-all font-mono text-xs text-slate-600">{record.id}</span>
                </p>
                {reason && <p className="mt-1 text-sm font-medium text-amber-900">Reason: {reason}</p>}
              </div>
              <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800" autoFocus>
                <Icon name="x" className="h-5 w-5" />
              </button>
            </div>

            {/* the switch, only when something changed */}
            {hasBefore && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-2 text-sm">
                <p className="text-slate-600">
                  {changedCount === 0 ? "No field changed (only the update time)." : `${changedCount} ${changedCount === 1 ? "field" : "fields"} changed, marked and listed first.`}
                </p>
                {changedCount > 0 && (
                  <label className="flex items-center gap-2 text-slate-700">
                    <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-navy-700 focus:ring-navy-500" />
                    Show only changed fields
                  </label>
                )}
              </div>
            )}

            {/* one line per field. The table scrolls inside the popup; the header row stays in view */}
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-2">Field</th>
                    {hasBefore && <th scope="col" className="px-3 py-2">Before</th>}
                    <th scope="col" className="px-3 py-2">{hasBefore ? "After" : "Value"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((r) => (
                    <tr key={r.key} className={cx("align-top", r.changed && "bg-amber-50")}>
                      <th scope="row" className="px-5 py-2 font-medium text-slate-700">
                        {r.label}
                        {/* the word too, not only the color (WCAG 1.4.1) */}
                        {r.changed && <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">Changed</span>}
                      </th>
                      {hasBefore && <td className="break-words px-3 py-2 text-slate-600">{r.before}</td>}
                      <td className={cx("break-words px-3 py-2", r.changed ? "font-medium text-slate-900" : "text-slate-600")}>{r.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* the stored data exactly as saved, for developers. Folded so it doesn't get in the way */}
              <details className="border-t border-slate-200 px-5 py-3">
                <summary className="cursor-pointer text-xs font-medium text-slate-600">Raw data (as saved in the database)</summary>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {raw.before != null && (
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-slate-600">Before</p>
                      <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-slate-900 p-3 text-[11px] text-slate-100">{JSON.stringify(raw.before, null, 2)}</pre>
                    </div>
                  )}
                  <div className={cx("min-w-0", raw.before == null && "sm:col-span-2")}>
                    <p className="text-[11px] font-medium text-slate-600">{raw.before != null ? "After" : "Saved"}</p>
                    <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-slate-900 p-3 text-[11px] text-slate-100">{JSON.stringify(raw.after, null, 2)}</pre>
                  </div>
                </div>
              </details>
            </div>

            <div className="flex justify-end border-t border-slate-200 px-5 py-3">
              <button type="button" onClick={() => ref.current?.close()} className={buttonClasses("secondary")}>
                Close
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
