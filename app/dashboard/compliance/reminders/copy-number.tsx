"use client"; // runs in the browser: it uses the clipboard

import { useRef, useState } from "react";

// R2: a small "Copy" button beside a customer's mobile number, for staff who call or text from another phone.
// It only copies the number that is already on the screen (Cashier and Admin can see it). It never calls or texts.
export function CopyNumber({ number }: { number: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle"); // what the button says
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null); // puts the word back to "Copy" after 2 seconds

  async function copy() {
    try {
      await navigator.clipboard.writeText(number); // the browser's clipboard
      setState("copied");
    } catch {
      setState("failed"); // e.g. the browser blocked the clipboard; the number is still on screen to copy by hand
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy mobile number ${number}`}
      // py-1 on phones = a bigger tap area; small and quiet on computers so the table stays clean
      className="inline-block rounded px-1 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-navy-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 min-[1100px]:py-0"
    >
      {/* aria-live = screen readers hear "Copied" */}
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy"}</span>
    </button>
  );
}
