import Image from "next/image";
import type { ReactNode } from "react";

/**
 * The sign-in and password screens. Desktop: a navy panel on the left with the CTM Pawnshop logo, PawnTrack and Pawnshop Management
 * and the form on the right. Phone and tablet: a slim navy band with the name, then the form. Light only, like the rest of
 * the app. The form is anchored from the top (not centered), so opening the help box below it never moves the fields.
 */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-white lg:grid lg:grid-cols-[5fr_6fr]">
      {/* phone and tablet: the brand band */}
      <header className="flex items-center justify-between gap-4 bg-navy-900 px-5 py-3 sm:px-8 lg:hidden">
        <span className="block rounded-lg bg-white px-2.5 py-1.5">
          <Image src="/ctm-logo.webp" alt="CTM Pawnshop" width={960} height={278} priority className="h-8 w-auto" />
        </span>
        <span className="text-right text-[11px] font-semibold uppercase leading-tight tracking-[0.14em] text-navy-200">PawnTrack<br />Pawnshop Management</span>
      </header>

      {/* desktop: the brand panel (the pattern is decoration, hidden from screen readers) */}
      <aside className="relative hidden items-center justify-center overflow-hidden bg-navy-900 lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(60rem 36rem at -10% -10%, rgba(212,164,41,0.20), transparent 60%), linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
            backgroundSize: "auto, 44px 44px, 44px 44px",
          }}
        />
        <div className="relative flex w-full max-w-md flex-col items-center px-8 text-center">
          {/* the logo on a light card: its dark blue "PAWNSHOP" would not read straight on navy */}
          <span className="block w-full rounded-2xl bg-white px-8 py-7 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)] ring-1 ring-white/30">
            <Image src="/ctm-logo.webp" alt="CTM Pawnshop" width={960} height={278} priority sizes="400px" className="h-auto w-full" />
          </span>
          <p className="mt-8 font-display text-3xl font-semibold text-white xl:text-4xl">PawnTrack</p>
          <p className="mt-2 text-base tracking-wide text-navy-200 xl:text-lg">Pawnshop Management</p>
        </div>
      </aside>

      {/* the form */}
      <div className="flex min-h-[calc(100vh-4.5rem)] flex-col lg:min-h-screen">
        {/* top-anchored: the space above is fixed, so what opens below the button can't push the fields around */}
        <div className="flex flex-1 items-start justify-center px-5 pb-8 pt-10 sm:px-8 sm:pt-16 lg:pt-[18vh]">
          <div className="w-full max-w-sm">
            <h1 className="font-display text-3xl font-semibold text-navy-900">{title}</h1>
            {subtitle && <p className="mt-2 text-base text-slate-600">{subtitle}</p>}
            <div className="mt-8">{children}</div>
          </div>
        </div>
        <footer className="px-5 pb-6 text-center text-xs text-slate-600 sm:px-8">Authorized staff only. Activity is recorded in the audit trail.</footer>
      </div>
    </main>
  );
}
