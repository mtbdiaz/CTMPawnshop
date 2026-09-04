"use client";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button
      onClick={() => window.print()}
      className="print:hidden rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
    >
      {label}
    </button>
  );
}
