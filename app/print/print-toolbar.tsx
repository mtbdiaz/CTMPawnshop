"use client";

import { useRouter } from "next/navigation";
import { buttonClasses } from "@/components/ui";

export function PrintToolbar() {
  const router = useRouter();
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
