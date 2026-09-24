"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { activeHref, type NavSection } from "@/lib/nav";
import { Icon } from "./icons";
import { cx } from "./ui";
import { LogoutButton } from "./logout-button";

export function AppShell({
  sections,
  userName,
  roleLabel,
  children,
}: {
  sections: NavSection[];
  userName: string;
  roleLabel: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const current = activeHref(pathname);
  const [open, setOpen] = useState(false);

  const initials = userName
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const nav = (
    <nav aria-label="Main" className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-navy-300/70">{section.title}</p>
          <ul className="mt-1.5 space-y-0.5">
            {section.items.map((item) => {
              const active = item.href === current;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cx(
                      "relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-white/10 font-medium text-white"
                        : "text-navy-100/80 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    {active && <span className="absolute inset-y-1.5 left-0 w-1 rounded-r bg-gold-400" aria-hidden="true" />}
                    <Icon name={item.icon} className={cx("h-4 w-4 shrink-0", active ? "text-gold-300" : "text-navy-300")} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brand = (
    <Link href="/dashboard" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-5 py-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-gold-300 to-gold-600 font-display text-[11px] font-bold text-navy-900 shadow">
        CTM
      </span>
      <span className="leading-tight">
        <span className="block font-display text-base font-semibold text-white">CTM PawnTrack</span>
        <span className="block text-[11px] text-gold-300/80">Gold pawn management</span>
      </span>
    </Link>
  );

  const account = (
    <div className="border-t border-white/10 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-700 text-xs font-semibold text-gold-200">
          {initials || "?"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{userName}</p>
          <p className="text-xs text-navy-200/80">{roleLabel}</p>
        </div>
      </div>
      <LogoutButton />
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 lg:pl-64 print:pl-0">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-navy-900 lg:flex print:hidden">
        {brand}
        {nav}
        {account}
      </aside>

      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-navy-800 bg-navy-900 px-4 py-2 lg:hidden print:hidden">
        <Link href="/dashboard" className="font-display text-base font-semibold text-white">
          CTM PawnTrack
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={open}
          className="rounded-md p-2 text-navy-100 hover:bg-white/10"
        >
          <Icon name="menu" className="h-5 w-5" />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            className="absolute inset-0 bg-navy-950/60"
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
          />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col bg-navy-900 shadow-xl">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
                className="rounded-md p-2 text-navy-100 hover:bg-white/10"
              >
                <Icon name="x" className="h-5 w-5" />
              </button>
            </div>
            {nav}
            {account}
          </aside>
        </div>
      )}

      <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">
        {children}
      </main>
    </div>
  );
}
