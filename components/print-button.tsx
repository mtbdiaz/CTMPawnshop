"use client";

import { buttonClasses } from "./ui";
import { Icon } from "./icons";

export function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClasses("secondary")}>
      <Icon name="printer" className="h-4 w-4" />
      {label}
    </button>
  );
}
