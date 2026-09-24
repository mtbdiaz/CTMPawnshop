import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icons";
import { humanize } from "@/lib/format";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

/* ---------- Buttons ---------- */

export type ButtonVariant = "primary" | "secondary" | "danger" | "success" | "ghost";
export type ButtonSize = "sm" | "md";

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md") {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 print:hidden",
    size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-sm",
    variant === "primary" && "bg-navy-800 text-white shadow-sm hover:bg-navy-700",
    variant === "secondary" && "border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50",
    variant === "danger" && "bg-red-700 text-white shadow-sm hover:bg-red-800",
    variant === "success" && "bg-emerald-700 text-white shadow-sm hover:bg-emerald-800",
    variant === "ghost" && "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  );
}

export function ButtonLink({
  href,
  children,
  variant = "secondary",
  size = "md",
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <Link href={href} className={buttonClasses(variant, size)}>
      {children}
    </Link>
  );
}

/* ---------- Page structure ---------- */

export type Crumb = { label: string; href?: string };

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 print:hidden">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
            {breadcrumbs.map((crumb, i) => (
              <li key={`${crumb.label}-${i}`} className="flex items-center gap-1">
                {i > 0 && <Icon name="chevron-right" className="h-3 w-3 text-slate-400" />}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-navy-700 hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="font-medium text-slate-700">
                    {crumb.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-navy-900">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div className={cx("rounded-xl border border-slate-200 bg-white shadow-sm print:shadow-none", padded && "p-5", className)}>
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  description,
  actions,
}: {
  children: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{children}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 print:hidden">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "gold" | "danger" | "warning" | "success";
  href?: string;
}) {
  const body = (
    <div
      className={cx(
        "h-full rounded-xl border bg-white p-4 shadow-sm transition-colors",
        tone === "default" && "border-slate-200",
        tone === "gold" && "border-gold-300 bg-gold-50",
        tone === "danger" && "border-red-200 bg-red-50",
        tone === "warning" && "border-amber-200 bg-amber-50",
        tone === "success" && "border-emerald-200 bg-emerald-50",
        href && "hover:border-navy-300",
      )}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-navy-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function DetailGrid({ items }: { items: { label: string; value: ReactNode; emphasize?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.label}</dt>
          <dd className={cx("mt-0.5 text-sm text-slate-900", item.emphasize && "text-lg font-semibold tabular-nums text-navy-900")}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- Status ---------- */

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "gold";

export function Badge({ tone = "neutral", children, icon }: { tone?: BadgeTone; children: ReactNode; icon?: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset",
        tone === "neutral" && "bg-slate-100 text-slate-700 ring-slate-300",
        tone === "info" && "bg-navy-50 text-navy-700 ring-navy-200",
        tone === "success" && "bg-emerald-50 text-emerald-800 ring-emerald-300",
        tone === "warning" && "bg-amber-50 text-amber-900 ring-amber-400",
        tone === "danger" && "bg-red-600 text-white ring-red-700",
        tone === "gold" && "bg-gold-100 text-gold-700 ring-gold-400",
      )}
    >
      {icon && tone === "danger" && <Icon name="alert" className="h-3 w-3" />}
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, BadgeTone> = {
  active: "info",
  extended: "gold",
  redeemed: "success",
  defaulted: "danger",
  forfeited: "danger",
  pawned: "info",
  queued_for_auction: "warning",
  pending: "warning",
  cleared: "success",
  confirmed: "danger",
  flagged: "warning",
  open: "warning",
  dismissed: "neutral",
  investigating: "warning",
  blacklisted: "danger",
  inactive: "neutral",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = STATUS_TONES[status] ?? "neutral";
  return (
    <Badge tone={tone} icon={tone === "danger"}>
      {label ?? humanize(status)}
    </Badge>
  );
}

/* ---------- Alerts & empty states ---------- */

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const icon = tone === "success" ? "check" : tone === "info" ? "info" : "alert";
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cx(
        "flex gap-3 rounded-lg border p-3 text-sm",
        tone === "info" && "border-navy-200 bg-navy-50 text-navy-800",
        tone === "success" && "border-emerald-300 bg-emerald-50 text-emerald-900",
        tone === "warning" && "border-amber-300 bg-amber-50 text-amber-900",
        tone === "danger" && "border-red-300 bg-red-50 text-red-900",
        className,
      )}
    >
      <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5" : undefined}>{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon = "info",
  title,
  description,
  action,
}: {
  icon?: Parameters<typeof Icon>[0]["name"];
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-navy-50 text-navy-600">
        <Icon name={icon} className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4 print:hidden">{action}</div>}
    </div>
  );
}

/* ---------- Tables ---------- */

export function Table({ children, minWidth = "640px" }: { children: ReactNode; minWidth?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 print:bg-white">
      <tr>{children}</tr>
    </thead>
  );
}

export function TH({ children, align = "left", className }: { children?: ReactNode; align?: "left" | "right"; className?: string }) {
  return (
    <th scope="col" className={cx("px-4 py-2.5", align === "right" && "text-right", className)}>
      {children}
    </th>
  );
}

/** Column header that toggles ?sort=&dir= while keeping the other query params. */
export function SortTH({
  label,
  column,
  current,
  dir,
  basePath,
  params = {},
  align = "left",
}: {
  label: string;
  column: string;
  current?: string;
  dir?: string;
  basePath: string;
  params?: Record<string, string | undefined>;
  align?: "left" | "right";
}) {
  const active = current === column;
  const nextDir = active && dir === "asc" ? "desc" : "asc";
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && k !== "sort" && k !== "dir" && k !== "page") query.set(k, v);
  query.set("sort", column);
  query.set("dir", nextDir);
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cx("px-4 py-2.5", align === "right" && "text-right")}
    >
      <Link
        href={`${basePath}?${query.toString()}`}
        className={cx("inline-flex items-center gap-1 hover:text-navy-700", active && "text-navy-800")}
      >
        {label}
        <Icon
          name={active && dir === "asc" ? "chevron-up" : "chevron-down"}
          className={cx("h-3 w-3 print:hidden", !active && "opacity-30")}
        />
      </Link>
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-slate-100">{children}</tbody>;
}

export function TR({ children, highlight }: { children: ReactNode; highlight?: "danger" | "warning" }) {
  return (
    <tr
      className={cx(
        "align-middle",
        !highlight && "hover:bg-slate-50",
        highlight === "danger" && "bg-red-50/70 hover:bg-red-50",
        highlight === "warning" && "bg-amber-50/70 hover:bg-amber-50",
      )}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  align = "left",
  className,
  mono,
}: {
  children?: ReactNode;
  align?: "left" | "right";
  className?: string;
  mono?: boolean;
}) {
  return (
    <td className={cx("px-4 py-3", align === "right" && "text-right tabular-nums", mono && "whitespace-nowrap font-mono text-xs", className)}>
      {children}
    </td>
  );
}

export function TableLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-navy-700 hover:text-navy-900 hover:underline">
      {children}
    </Link>
  );
}

/* ---------- Pagination ---------- */

export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params = {},
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const href = (p: number) => {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") query.set(k, v);
    if (p > 1) query.set("page", String(p));
    const qs = query.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 text-sm text-slate-600 print:hidden">
      <span>
        Showing <span className="font-medium text-slate-900">{from}</span>–
        <span className="font-medium text-slate-900">{to}</span> of{" "}
        <span className="font-medium text-slate-900">{total}</span>
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link href={href(page - 1)} className={buttonClasses("secondary", "sm")}>
              Previous
            </Link>
          ) : (
            <span className={cx(buttonClasses("secondary", "sm"), "pointer-events-none opacity-40")}>Previous</span>
          )}
          <span className="text-xs">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={href(page + 1)} className={buttonClasses("secondary", "sm")}>
              Next
            </Link>
          ) : (
            <span className={cx(buttonClasses("secondary", "sm"), "pointer-events-none opacity-40")}>Next</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Parses ?page= safely. */
export function pageParam(value: string | undefined): number {
  const n = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/* ---------- Search ---------- */

export function SearchBar({
  action,
  name = "q",
  defaultValue,
  placeholder,
  hidden = {},
}: {
  action: string;
  name?: string;
  defaultValue?: string;
  placeholder: string;
  hidden?: Record<string, string | undefined>;
}) {
  return (
    <form action={action} role="search" className="relative w-full max-w-sm print:hidden">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label htmlFor={`search-${name}`} className="sr-only">
        {placeholder}
      </label>
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        id={`search-${name}`}
        type="search"
        name={name}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm shadow-sm placeholder:text-slate-400 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20"
      />
    </form>
  );
}

/** Links styled as filter tabs (e.g. loan status). */
export function FilterTabs({
  tabs,
  current,
}: {
  tabs: { label: string; value: string; href: string; count?: number }[];
  current: string;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 print:hidden" role="tablist">
      {tabs.map((tab) => {
        const active = tab.value === current;
        return (
          <Link
            key={tab.value}
            href={tab.href}
            role="tab"
            aria-selected={active}
            className={cx(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              active ? "bg-white text-navy-800 shadow-sm" : "text-slate-600 hover:text-slate-900",
            )}
          >
            {tab.label}
            {tab.count !== undefined && <span className="ml-1 text-slate-400">{tab.count}</span>}
          </Link>
        );
      })}
    </div>
  );
}

/** Collapsible card for "create" forms that sit above a list. Opens via ?new=1 links. */
export function CreatePanel({
  title,
  description,
  defaultOpen,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group mb-6 rounded-xl border border-slate-200 bg-white shadow-sm print:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-5 py-4 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-800 text-white">
          <Icon name="plus" className="h-4 w-4" />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-semibold text-slate-900">{title}</span>
          {description && <span className="block text-xs text-slate-500">{description}</span>}
        </span>
        <Icon name="chevron-down" className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-slate-100 px-5 py-5">{children}</div>
    </details>
  );
}
