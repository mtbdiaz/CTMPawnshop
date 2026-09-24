import type { StaffRole } from "@/lib/auth/roles";
import { hasRole } from "@/lib/auth/roles";

export type NavIcon =
  | "home"
  | "users"
  | "scale"
  | "ticket"
  | "vault"
  | "clipboard"
  | "gavel"
  | "cash"
  | "bell"
  | "shield"
  | "log"
  | "chart"
  | "settings"
  | "id";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** Roles (besides Admin, who always has access) that the page's requireRole() allows. */
  roles: StaffRole[];
};

export type NavSection = { title: string; items: NavItem[] };

const EVERYONE: StaffRole[] = ["operator", "cashier", "appraiser"];

// Must stay in sync with each page's requireRole() — lib/nav.test.ts enforces
// this so a role never sees a menu item that just bounces them back.
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: "home", roles: EVERYONE }],
  },
  {
    title: "Pawn operations",
    items: [
      { href: "/dashboard/customers", label: "Customers", icon: "users", roles: EVERYONE },
      { href: "/dashboard/appraisals", label: "Appraisals", icon: "scale", roles: EVERYONE },
      { href: "/dashboard/loans", label: "Loans", icon: "ticket", roles: EVERYONE },
      { href: "/dashboard/compliance/reminders", label: "Due-date reminders", icon: "bell", roles: ["cashier"] },
    ],
  },
  {
    title: "Vault",
    items: [
      { href: "/dashboard/inventory", label: "Inventory", icon: "vault", roles: EVERYONE },
      { href: "/dashboard/inventory/audit", label: "Physical audit", icon: "clipboard", roles: ["operator"] },
      { href: "/dashboard/inventory/auction", label: "Auction prep", icon: "gavel", roles: ["operator"] },
    ],
  },
  {
    title: "Finance",
    items: [{ href: "/dashboard/finance", label: "Cash & ledger", icon: "cash", roles: ["operator", "cashier"] }],
  },
  {
    title: "Oversight",
    items: [
      { href: "/dashboard/compliance", label: "Suspicious activity", icon: "shield", roles: [] },
      { href: "/dashboard/compliance/audit", label: "Audit trail", icon: "log", roles: [] },
      { href: "/dashboard/reports", label: "Reports", icon: "chart", roles: [] },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/dashboard/settings", label: "System settings", icon: "settings", roles: [] },
      { href: "/dashboard/users", label: "User accounts", icon: "id", roles: [] },
    ],
  },
];

export function navForRole(role: StaffRole): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => hasRole(role, item.roles)),
  })).filter((section) => section.items.length > 0);
}

const ALL_HREFS = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));

/** The nav href that best matches the current path (longest prefix wins). */
export function activeHref(pathname: string): string | null {
  let best: string | null = null;
  for (const href of ALL_HREFS) {
    const matches = pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
    if (matches && (!best || href.length > best.length)) best = href;
  }
  return best;
}
