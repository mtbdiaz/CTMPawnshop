"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
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

/** "Maria Dela Cruz" -> "MD", "Test Admin" -> "TA", "Ana" -> "A" */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// the soft cream wash behind the menu, the same family as the login panel (decoration only)
const SIDEBAR_BG: React.CSSProperties = {
  backgroundImage:
    "radial-gradient(22rem 16rem at 0% 0%, rgba(255,255,255,0.95), transparent 70%), linear-gradient(180deg, var(--color-gold-50) 0%, #fffdf6 42%, var(--color-gold-100) 140%)",
};

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

  // On short screens (1366x768) the menu scrolls, and the last items (Settings, Archive) start below the fold.
  // Bring the current page's item into view inside the menu, so the highlighted item is never half hidden.
  // "nearest" only scrolls the menu itself, and does nothing when the item is already fully visible.
  useEffect(() => {
    document.querySelectorAll<HTMLElement>('nav[aria-label="Main"] [aria-current="page"]').forEach((el) => {
      if (el.offsetParent !== null) el.scrollIntoView({ block: "nearest" });
    });
  }, [current]);

  const nav = (rail: boolean) => (
    <nav aria-label="Main" className="sidebar-scroll flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 pt-2">
      {sections.map((section, s) => (
        <div key={section.title} className={cx(s > 0 && "mt-4")}>
          {/* expanded: the section name. collapsed: a thin rule, so the groups still read as groups */}
          <div className="relative h-6">
            <p
              className={cx(
                "absolute inset-x-0 top-1 flex items-center gap-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 transition-opacity duration-200 motion-reduce:transition-none",
                rail && "opacity-0",
              )}
              aria-hidden={rail}
            >
              {section.title}
              <span className="h-px flex-1 bg-gold-200" />
            </p>
            <span
              aria-hidden="true"
              className={cx("absolute inset-x-2 top-3 h-px bg-gold-200 transition-opacity duration-200 motion-reduce:transition-none", !rail && "opacity-0")}
            />
          </div>
          <ul className="mt-0.5 space-y-0.5">
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
                      "relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13.5px] transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-navy-500 motion-reduce:transition-none",
                      active
                        ? "bg-white font-semibold text-navy-900 shadow-[0_1px_2px_rgba(10,22,40,0.08),0_0_0_1px_rgba(212,164,41,0.28)]"
                        : "text-slate-700 hover:bg-white/70 hover:text-navy-900",
                    )}
                  >
                    {/* the gold marker on the page you are on */}
                    <span
                      aria-hidden="true"
                      className={cx(
                        "absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-gold-500 transition-opacity duration-150 motion-reduce:transition-none",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span
                      className={cx(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors duration-150 motion-reduce:transition-none",
                        active ? "bg-navy-800 text-gold-300" : "bg-gold-100/70 text-gold-700 group-hover:bg-gold-100",
                      )}
                    >
                      <Icon name={item.icon} className="h-4 w-4" />
                    </span>
                    <span className={cx("truncate transition-opacity duration-200 ease-out motion-reduce:transition-none", rail && "pointer-events-none opacity-0")}>
                      {item.label}
                    </span>
                  </Link>
                  {rail && (
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-navy-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
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
    <Link
      href="/dashboard"
      onClick={() => setOpen(false)}
      className={cx(
        "block shrink-0 overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-navy-500",
        rail ? "flex h-16 items-center justify-center" : "px-5 pb-2 pt-5",
      )}
      aria-label="CTM Pawnshop PawnTrack dashboard"
    >
      {rail ? (
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-gold-400 to-gold-600 font-mono text-[11px] font-bold tracking-wide text-navy-950 shadow-[0_2px_10px_rgba(212,164,41,0.35)]">
          CTM
        </span>
      ) : (
        <>
          {/* the logo was made for a light background, so it sits on the cream menu as it is */}
          <Image src="/ctm-logo.webp" alt="CTM Pawnshop" width={960} height={278} priority sizes="224px" className="mx-auto h-auto w-full max-w-[196px] drop-shadow-[0_4px_8px_rgba(10,22,40,0.15)]" />
          <span className="mx-auto mt-3 block h-0.5 w-10 rounded-full bg-gold-500" aria-hidden="true" />
          <span className="mt-2 block text-center text-[10px] font-semibold uppercase tracking-[0.22em] text-navy-700">PawnTrack</span>
        </>
      )}
    </Link>
  );

  // the signed-in staff member, at the bottom of the side menu: avatar, name, role, sign out
  const account = (rail: boolean) => (
    <div className="shrink-0 border-t border-gold-200 p-3">
      <div
        className={cx("flex items-center gap-3 rounded-lg px-1.5 py-1.5", !rail && "bg-white shadow-[0_1px_2px_rgba(10,22,40,0.06),0_0_0_1px_rgba(10,22,40,0.05)]")}
        title={rail ? `${userName} · ${roleLabel}` : undefined}
      >
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-800 text-xs font-semibold text-gold-300 ring-2 ring-gold-300/60">
          {initials(userName)}
        </span>
        <span className={cx("min-w-0 leading-tight transition-opacity duration-200 motion-reduce:transition-none", rail && "pointer-events-none w-0 opacity-0")}>
          <span className="block truncate text-[13px] font-semibold text-navy-900">{userName}</span>
          <span className="block truncate text-[11px] text-slate-600">{roleLabel}</span>
        </span>
      </div>
      <div className="mt-1">
        <LogoutButton variant="sidebar" rail={rail} />
      </div>
    </div>
  );

  return (
    <div
      className={cx(
        "min-h-screen bg-white transition-[padding] duration-200 ease-out motion-reduce:transition-none print:pl-0",
        collapsed ? "lg:pl-[72px]" : "lg:pl-64",
      )}
    >
      <aside
        style={SIDEBAR_BG}
        className={cx(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-gold-200/80 transition-[width] duration-200 ease-out motion-reduce:transition-none lg:flex print:hidden",
          collapsed ? "w-[72px]" : "w-64",
        )}
      >
        {brand(collapsed)}
        {nav(collapsed)}
        <div className="shrink-0 px-3 pb-2">
          <button
            type="button"
            onClick={() => writeCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex h-8 w-full items-center gap-3 rounded-lg px-2.5 text-xs text-slate-600 transition-colors hover:bg-white/70 hover:text-navy-900 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-navy-500 motion-reduce:transition-none"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center">
              <Icon name={collapsed ? "chevron-right" : "arrow-left"} className="h-4 w-4" />
            </span>
            <span className={cx("transition-opacity duration-200 motion-reduce:transition-none", collapsed && "opacity-0")}>Collapse menu</span>
          </button>
        </div>
        {account(collapsed)}
      </aside>

      <header className="sticky top-0 z-20 flex h-12 items-center border-b border-slate-200 bg-white px-4 print:hidden sm:px-6 lg:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={open}
            className="rounded-md p-1.5 text-slate-700 hover:bg-slate-100"
          >
            <Icon name="menu" className="h-5 w-5" />
          </button>
          {/* D4: app name shown on phones next to the menu button.
              whitespace-nowrap = never break this text onto 2 lines */}
          <span className="whitespace-nowrap font-display text-base font-semibold text-navy-900">CTM PawnTrack</span>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" className="absolute inset-0 bg-navy-950/50 backdrop-blur-[2px]" aria-label="Close navigation menu" onClick={() => setOpen(false)} />
          <aside style={SIDEBAR_BG} className="relative flex h-full w-72 max-w-[85vw] flex-col shadow-2xl">
            <div className="flex items-center justify-between pr-2">
              {brand(false)}
              <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation menu" className="rounded-md p-2 text-slate-600 hover:bg-white/70">
                <Icon name="x" className="h-5 w-5" />
              </button>
            </div>
            {nav(false)}
            {account(false)}
          </aside>
        </div>
      )}

      <main id="main" className="mx-auto max-w-7xl px-4 py-5 sm:px-6 print:max-w-none print:p-0">
        {children}
      </main>
    </div>
  );
}
