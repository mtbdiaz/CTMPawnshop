import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

// What the system does for the people signing in. Every line is true of the app today (roles: lib/nav.ts, audit trail:
// the Reports page, idle sign-out: components/session-timeout-watcher.tsx, 15 minutes).
const POINTS: { icon: IconName; title: string; text: string }[] = [
  { icon: "shield", title: "Access by role", text: "Cashier, Operator, Appraiser and Admin each see only the screens their work needs." },
  { icon: "log", title: "Every change is recorded", text: "The audit trail keeps who did what, and when." },
  { icon: "logout", title: "Signs out when idle", text: "After 15 minutes without activity, so a counter screen is never left open." },
];

function Logo({ onDark = false }: { onDark?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-md bg-gold-500 text-xs font-bold tracking-wide text-navy-900">CTM</span>
      <span className="leading-tight">
        <span className={onDark ? "block text-base font-semibold text-white" : "block text-base font-semibold text-navy-900"}>CTM PawnTrack</span>
        <span className={onDark ? "block text-xs text-navy-200" : "block text-xs text-slate-600"}>CTM Pawnshop management</span>
      </span>
    </div>
  );
}

/**
 * The sign-in and password screens. Desktop: a navy panel on the left (what the system is and what it protects) and the
 * form on the right. Phone and tablet: a slim navy band with the name, then the form, so the form is the first thing
 * under the thumb. Light only, like the rest of the app. Nothing here moves, so there is nothing to turn off for
 * people who ask for less motion.
 */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-white lg:grid lg:grid-cols-[5fr_6fr]">
      {/* phone and tablet: the brand band */}
      <header className="bg-navy-900 px-5 py-4 sm:px-8 lg:hidden">
        <Logo onDark />
      </header>

      {/* desktop: the brand panel (decoration is hidden from screen readers; the text beside it is what matters) */}
      <aside className="relative hidden overflow-hidden bg-navy-900 text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(60rem 36rem at -10% -10%, rgba(212,164,41,0.20), transparent 60%), linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
            backgroundSize: "auto, 44px 44px, 44px 44px",
          }}
        />
        <div className="relative">
          <Logo onDark />
        </div>
        <div className="relative max-w-md">
          <p className="font-display text-4xl font-semibold leading-tight text-white xl:text-5xl">Every loan, payment and item in one place.</p>
          <p className="mt-4 text-base text-navy-200">The daily counter work of CTM Pawnshop: appraisals, pawn loans, payments, renewals and the vault.</p>
          <ul className="mt-10 space-y-5">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/5 text-gold-400">
                  <Icon name={p.icon} className="h-[18px] w-[18px]" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-white">{p.title}</span>
                  <span className="block text-sm text-navy-200">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-navy-300">63 Rizal St., Poblacion, Kiblawan, Davao del Sur</p>
      </aside>

      {/* the form */}
      <div className="flex min-h-[calc(100vh-4.5rem)] flex-col lg:min-h-screen">
        <div className="flex flex-1 items-start justify-center px-5 py-8 sm:items-center sm:px-8 sm:py-10">
          <div className="w-full max-w-sm">
            <h1 className="font-display text-3xl font-semibold text-navy-900">{title}</h1>
            <p className="mt-2 text-base text-slate-600">{subtitle}</p>
            <div className="mt-8">{children}</div>
          </div>
        </div>
        <footer className="px-5 pb-6 text-center text-xs text-slate-600 sm:px-8">Authorized staff only. Activity is recorded in the audit trail.</footer>
      </div>
    </main>
  );
}
