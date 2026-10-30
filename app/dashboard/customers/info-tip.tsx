"use client"; // runs in the browser: it opens a small box when clicked

// useId = a unique id for each box; useRef = points at the button and the box
import { useId, useRef, type ReactNode } from "react";
// Icon = the small line icons used across the app
import { Icon } from "@/components/icons";

// R2: a small "i" button next to a column heading. Click, tap, or press Enter/Space to open a short explanation.
// Esc or clicking anywhere else closes it. It uses the browser's built-in popover, so it floats above the table
// (the table's scroll box can't cut it off) and works with the keyboard and screen readers.
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId(); // links the button to its box
  const button = useRef<HTMLButtonElement>(null); // the "i" button
  const box = useRef<HTMLDivElement>(null); // the explanation box

  // puts the box just under the button, kept inside the screen
  function place() {
    const b = button.current?.getBoundingClientRect(); // where the button is on screen
    const el = box.current;
    if (!b || !el) return;
    const width = 288; // the box is 18rem (288px) wide
    const left = Math.min(Math.max(8, b.left + b.width / 2 - width / 2), window.innerWidth - width - 8); // centred, but never off the edge
    el.style.left = `${left}px`; // horizontal position
    el.style.top = `${b.bottom + 6}px`; // 6px below the button
  }

  return (
    <>
      {/* the "i" button. popoverTarget = clicking it opens/closes the box with this id */}
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        onClick={place}
        aria-label={`What does ${label} mean?`}
        className="inline-flex rounded text-slate-500 hover:text-navy-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
      >
        <Icon name="info" className="h-3.5 w-3.5" />
      </button>
      {/* the explanation box. popover="auto" = Esc or clicking outside closes it.
          normal-case / font-normal / tracking-normal undo the uppercase style of the column heading it sits in.
          The shadow is allowed because it floats above the page. */}
      <div
        ref={box}
        id={id}
        popover="auto"
        className="fixed inset-auto m-0 w-72 rounded-md border border-slate-200 bg-white p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-700 shadow-lg"
      >
        {/* the title of the box, e.g. "Score" */}
        <p className="mb-1 font-semibold text-slate-900">{label}</p>
        {children}
      {/* end of the explanation box */}
      </div>
    </>
  );
}