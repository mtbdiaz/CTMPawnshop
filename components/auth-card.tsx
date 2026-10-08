import type { ReactNode } from "react";

/** Plain sign-in and password screens: one card, no marketing copy. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gold-500 text-[11px] font-bold text-navy-900">CTM</span>
          <span className="text-base font-semibold text-navy-900">CTM PawnTrack</span>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-6">
          <h1 className="text-xl font-semibold text-navy-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-4 text-xs text-slate-500">Authorized staff only. Activity is recorded in the audit trail.</p>
      </div>
    </main>
  );
}
