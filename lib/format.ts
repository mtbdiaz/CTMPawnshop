const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPeso(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return pesoFormatter.format(Number.isFinite(n) ? n : 0);
}

// Date-only columns (loan_date, maturity_date) are stored as YYYY-MM-DD with
// no timezone; parsing them with `new Date()` would shift them to the
// previous day west of UTC, so they're formatted from their parts instead.
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  return new Date(value).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Manila",
  });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  });
}

export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const MANILA_OFFSET = "+08:00";

/** Today's calendar date in the shop's timezone (Asia/Manila), as YYYY-MM-DD. */
export function manilaToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

/** ISO timestamp for the start of a Manila calendar day (defaults to today). */
export function manilaDayStart(date: string = manilaToday()): string {
  return `${date}T00:00:00${MANILA_OFFSET}`;
}

/** ISO timestamp for the end of a Manila calendar day. */
export function manilaDayEnd(date: string = manilaToday()): string {
  return `${date}T23:59:59.999${MANILA_OFFSET}`;
}
