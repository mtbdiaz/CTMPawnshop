"use client"; // runs in the browser: it opens a popup

import { useEffect, useRef, useState, type ReactNode } from "react";
import { buttonClasses, cx } from "./ui";
import { Icon } from "./icons";

// RH2 (Nov 11): a small button that opens its form in a popup on the same page. Used inside table rows instead of a
// fold-out (<details>), which made the row taller and pushed the other columns around (Matt: "ma guba ang columns").
// primary (CL1): draw the button as the page's main action (navy, like "New loan") instead of the small row button.
// ariaLabel (CL2): what a screen reader says for the button when the short label alone is not enough, e.g. ten
// "Details" buttons in a list: "Details of Payment received, Nov 11, PT-2026...".
// dataAttr (SA6): marks the button (data-<name>) so a page can find it again, e.g. to move the keyboard focus to the
// next "Review flag" after a row leaves the list.
// wide (SA7): a wider popup (40rem instead of 28rem) for popups with a lot to read, e.g. Review flag, so it is
// less tall. On a phone it is still the screen width minus a small margin.
export function PopupButton({
  label,
  title,
  children,
  className,
  primary,
  ariaLabel,
  dataAttr,
  wide,
}: {
  label: string;
  title: string;
  children: ReactNode;
  className?: string;
  primary?: boolean;
  ariaLabel?: string;
  dataAttr?: string;
  wide?: boolean;
}) {
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
        aria-label={ariaLabel}
        {...(dataAttr ? { [`data-${dataAttr}`]: "" } : {})}
        className={cx(
          primary
            ? buttonClasses("primary") + " whitespace-nowrap"
            : "whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500",
          className,
        )}
      >
        {label}
      </button>
      {open && (
        <dialog
          ref={ref}
          aria-label={title}
          // e.target check: a confirm box inside the form closing must not close this popup
          onClose={(e) => e.target === e.currentTarget && setOpen(false)}
          onCancel={(e) => e.stopPropagation()}
          onClick={(e) => e.target === e.currentTarget && ref.current?.close()} // a click on the dark area closes it
          className={cx(
            "m-auto max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-md border border-slate-200 p-0 text-left shadow-2xl backdrop:bg-navy-950/50",
            wide ? "w-[min(40rem,calc(100vw-2rem))]" : "w-[min(28rem,calc(100vw-2rem))]",
          )}
        >
          {/* SA7: the title row stays at the top while a long popup scrolls, so Close is always in reach */}
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <Icon name="x" className="h-5 w-5" />
            </button>
          </div>
          <div className="px-5 py-4">{children}</div>
        </dialog>
      )}
    </>
  );
}
