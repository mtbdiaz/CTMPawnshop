"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { buttonClasses } from "@/components/ui";
import { MM_PER_CSS_PX, THERMAL_WIDTH_MM, thermalCss } from "@/lib/print";

export function PrintToolbar() {
  const router = useRouter();

  // Size the paper to the slip so roll printers don't feed blank paper.
  useEffect(() => {
    const slip = document.querySelector<HTMLElement>(".thermal");
    if (!slip) return;
    const style = document.createElement("style");
    style.textContent = thermalCss(THERMAL_WIDTH_MM, slip.scrollHeight * MM_PER_CSS_PX);
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  return (
    <div className="flex justify-center gap-2 border-b border-slate-200 bg-slate-50 p-3 print:hidden">
      <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => router.back()}>
        Back
      </button>
      <button type="button" className={buttonClasses("primary", "sm")} onClick={() => window.print()}>
        Print
      </button>
    </div>
  );
}
