"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { activeHref, type NavSection } from "@/lib/nav";
import { Icon } from "./icons";
import { cx } from "./ui";
import { LogoutButton } from "./logout-button";

const STORAGE_KEY = "ctm.sidebar.collapsed";
const listeners = new Set<() => void>();

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // storage unavailable (private mode): state just won't persist
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

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
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);

  const nav = (rail: boolean) => (
    <nav aria-label="Main" className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-2 py-3">
      {sections.map((section) => (
        <div key={section.title}>
          <p
            className={cx(
              "px-3 text-[10px] font-semibold uppercase tracking-wider text-navy-300/70 transition-opacity duration-200 motion-reduce:transition-none",
              rail && "opacity-0",
            )}
            aria-hidden={rail}
          >
            {section.title}
          </p>
          <ul className="mt-1 space-y-0.5">
            {section.items.map((item) => {
              const active = item.href === current;
              return (
                <li key={item.href} className="group relative">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    aria-label={rail ? item.label : undefined}
                    onClick={() => setOpen(false)}
                    className={cx(
                      "relative flex h-8 items-center gap-3 rounded-md px-3 text-sm transition-colors focus-visible:outline-gold-400",
                      active ? "bg-white/10 font-medium text-white" : "text-navy-100/80 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    {active && <span className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-gold-400" aria-hidden="true" />}
                    <Icon name={item.icon} className={cx("h-4 w-4 shrink-0", active ? "text-gold-300" : "text-navy-300")} />
                    <span
                      className={cx(
                        "truncate transition-opacity duration-200 ease-out motion-reduce:transition-none",
                        rail && "pointer-events-none opacity-0",
                      )}
                    >
                      {item.label}
                    </span>
                  </Link>
                  {rail && (
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded bg-navy-950 px-2 py-1 text-xs text-white opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
                    >
                      {item.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brand = (rail: boolean) => (
    <Link href="/dashboard" onClick={() => setOpen(false)} className="flex h-12 items-center gap-2.5 px-4" aria-label="CTM PawnTrack dashboard">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-gold-500 font-mono text-[10px] font-bold text-navy-950">CTM</span>
      <span className={cx("font-display text-base font-semibold text-white transition-opacity duration-200 motion-reduce:transition-none", rail && "opacity-0")}>
        PawnTrack
      </span>
    </Link>
  );

  return (
    <div
      className={cx(
        "min-h-screen bg-slate-50 transition-[padding] duration-200 ease-out motion-reduce:transition-none print:pl-0",
        collapsed ? "lg:pl-14" : "lg:pl-52",
      )}
    >
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-30 hidden flex-col bg-navy-900 transition-[width] duration-200 ease-out motion-reduce:transition-none lg:flex print:hidden",
          collapsed ? "w-14" : "w-52",
        )}
      >
        {brand(collapsed)}
        {nav(collapsed)}
        <button
          type="button"
          onClick={() => writeCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="m-2 flex h-8 items-center gap-3 rounded-md px-3 text-xs text-navy-200 hover:bg-white/5 hover:text-white"
        >
          <Icon name={collapsed ? "chevron-right" : "arrow-left"} className="h-4 w-4 shrink-0" />
          <span className={cx("transition-opacity duration-200 motion-reduce:transition-none", collapsed && "opacity-0")}>Collapse</span>
        </button>
      </aside>

      <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-slate-200 bg-white px-4 print:hidden sm:px-6">
        <div className="flex items-center gap-2 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={open}
            className="rounded-md p-1.5 text-slate-700 hover:bg-slate-100"
          >
            <Icon name="menu" className="h-5 w-5" />
          </button>
          <span className="font-display text-base font-semibold text-navy-900">CTM PawnTrack</span>
        </div>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-slate-700">
            {userName} <span className="text-slate-400">·</span> <span className="text-slate-500">{roleLabel}</span>
          </span>
          <LogoutButton />
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" className="absolute inset-0 bg-navy-950/60" aria-label="Close navigation menu" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-64 max-w-[85vw] flex-col bg-navy-900">
            <div className="flex items-center justify-between pr-2">
              {brand(false)}
              <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation menu" className="rounded-md p-2 text-navy-100 hover:bg-white/10">
                <Icon name="x" className="h-5 w-5" />
              </button>
            </div>
            {nav(false)}
          </aside>
        </div>
      )}

      <main id="main" className="mx-auto max-w-7xl px-4 py-5 sm:px-6 print:max-w-none print:p-0">
        {children}
      </main>
    </div>
  );
}
