import Image from "next/image";
import type { ReactNode } from "react";

/**
 * The sign-in and password screens. Desktop: a light panel on the left with just the CTM Pawnshop logo
 * and the form on the right. Phone and tablet: a slim white band with the logo, then the form. Light only, like the rest of
 * the app. The form is anchored from the top (not centered), so opening the help box below it never moves the fields.
 */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-white lg:grid lg:grid-cols-[5fr_6fr]">
      {/* phone and tablet: the logo on white, with a gold line under it */}
      <header className="flex items-center justify-between gap-4 border-b-[3px] border-gold-400 bg-white px-5 py-3 sm:px-8 lg:hidden">
        <Image src="/ctm-logo.webp" alt="CTM Pawnshop" width={960} height={278} priority className="h-10 w-auto" />
        <span className="text-right text-[11px] font-semibold uppercase leading-tight tracking-[0.14em] text-navy-700">PawnTrack<br />Pawnshop Management</span>
      </header>

      {/* desktop: a light brand panel, so the logo (made for a light background) sits on it as it is. The pattern is decoration. */}
      <aside className="relative hidden items-center justify-center overflow-hidden border-r border-slate-200 bg-gradient-to-br from-white via-gold-50 to-gold-100 lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(40rem 28rem at 50% 42%, rgba(255,255,255,0.9), transparent 70%), linear-gradient(rgba(10,22,40,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(10,22,40,0.035) 1px, transparent 1px)",
            backgroundSize: "auto, 44px 44px, 44px 44px",
          }}
        />
        <div className="relative flex w-full max-w-lg flex-col items-center px-10 text-center">
          <Image src="/ctm-logo.webp" alt="CTM Pawnshop" width={960} height={278} priority sizes="512px" className="h-auto w-full drop-shadow-[0_10px_18px_rgba(10,22,40,0.18)]" />
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
