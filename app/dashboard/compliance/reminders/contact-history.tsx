"use client"; // runs in the browser: it opens a popup

import { useEffect, useRef, useState } from "react";
import { Badge, buttonClasses, type BadgeTone } from "@/components/ui";
import { Icon } from "@/components/icons";

// RH1 (Matt, Nov 11): "Contact history" opened inside the table row, so the row grew and the other columns
// jumped up and down. Now it opens a small popup on the same page; the row stays the same height.
export type HistoryItem = {
  result: string; // "No answer"
  tone: BadgeTone; // the badge color, same as on the row
  line: string; // "Call · Nov 9, 2:15 PM · Ana"
  note?: string | null; // what the staff member wrote
  earlier: boolean; // logged before the loan's current due date (before a renewal)
};

export function ContactHistoryButton({ customer, ticket, items }: { customer: string; ticket: string; items: HistoryItem[] }) {
  const ref = useRef<HTMLDialogElement>(null); // the <dialog>
  const [open, setOpen] = useState(false); // true while the popup shows
  useEffect(() => {
    if (open) ref.current?.showModal(); // on top of the page; the page behind can't be clicked
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-0.5 block rounded text-left text-navy-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
      >
        Contact history ({items.length})
      </button>
      {open && (
        <dialog
          ref={ref}
          aria-labelledby="history-title"
          onClose={() => setOpen(false)}
          onClick={(e) => e.target === e.currentTarget && ref.current?.close()} // a click on the dark area closes it
          className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-slate-200 p-0 shadow-2xl backdrop:bg-navy-950/50"
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div className="min-w-0">
              <h2 id="history-title" className="text-lg font-semibold text-slate-900">
                Contact history
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {customer} · <span className="font-mono text-xs">{ticket}</span>
              </p>
            </div>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800" autoFocus>
              <Icon name="x" className="h-5 w-5" />
            </button>
          </div>
          {/* newest first, the same order as the database gives them */}
          <ol className="divide-y divide-slate-100 px-5 text-sm">
            {items.map((l, i) => (
              <li key={i} className="py-3">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={l.tone}>{l.result}</Badge>
                  {/* a log from before the loan's current due date (before a renewal) */}
                  {l.earlier && <span className="text-xs text-slate-500">Earlier due date</span>}
                </span>
                <span className="mt-1 block text-slate-600">{l.line}</span>
                {l.note && <span className="mt-1 block break-words italic text-slate-700">&ldquo;{l.note}&rdquo;</span>}
              </li>
            ))}
          </ol>
          <div className="flex justify-end border-t border-slate-200 px-5 py-3">
            <button type="button" onClick={() => ref.current?.close()} className={buttonClasses("secondary")}>
              Close
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
