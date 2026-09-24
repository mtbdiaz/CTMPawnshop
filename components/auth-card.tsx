import type { ReactNode } from "react";

/** Branded split layout for the sign-in and password screens. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-gold-500/10 blur-3xl" aria-hidden="true" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-gold-300 to-gold-600 font-display text-sm font-bold text-navy-900">
            CTM
          </span>
          <span className="font-display text-xl font-semibold">CTM PawnTrack</span>
        </div>
        <div className="relative max-w-md">
          <p className="font-display text-4xl font-semibold leading-tight">
            Gold pawn management, <span className="text-gold-300">done right.</span>
          </p>
          <p className="mt-4 text-navy-100/80">
            Appraisals, pawn tickets, payments, vault inventory and compliance — in one secure system for CTM Pawnshop staff.
          </p>
        </div>
        <p className="relative text-xs text-navy-200/60">Authorized staff only. All activity is recorded in the audit trail.</p>
      </section>
      <section className="flex items-center justify-center bg-slate-50 px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-gold-300 to-gold-600 font-display text-[11px] font-bold text-navy-900">
              CTM
            </span>
            <span className="font-display text-lg font-semibold text-navy-900">CTM PawnTrack</span>
          </div>
          <h1 className="font-display text-2xl font-semibold text-navy-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </main>
  );
}
