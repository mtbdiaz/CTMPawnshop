// Date maths for the calendar pop-up (components/picker-enhancer.tsx). Pure functions, no browser needed.
// A day is always the text "YYYY-MM-DD", the same thing <input type="date"> holds, so no time zone can shift it.

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function toIso(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`; // month is 1-12
}

/** "2026-11-15" -> { year, month (1-12), day }, or null when it is empty or not a real day (e.g. 2026-02-30). */
export function parseIso(value: string | null | undefined): { year: number; month: number; day: number } | null {
  const m = ISO.exec(value ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate(); // month 1-12: day 0 of the next month = last day of this one
}

/** The day of the week of the 1st of a month, 0 = Sunday. */
export function firstWeekday(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

/** Moves a day by whole days (can be negative). */
export function addDays(iso: string, days: number): string {
  const p = parseIso(iso);
  if (!p) return iso;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Moves a day by whole months; the day is kept, or pulled back to the last day of a shorter month (Jan 31 + 1 = Feb 28). */
export function addMonths(iso: string, months: number): string {
  const p = parseIso(iso);
  if (!p) return iso;
  const total = p.year * 12 + (p.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12 + 12) % 12 + 1;
  return toIso(year, month, Math.min(p.day, daysInMonth(year, month)));
}

/** Keeps a day inside the allowed range (the input's min and max, either can be empty). */
export function clampIso(iso: string, min?: string, max?: string): string {
  if (min && parseIso(min) && iso < min) return min;
  if (max && parseIso(max) && iso > max) return max;
  return iso;
}

export function isDisabledDay(iso: string, min?: string, max?: string): boolean {
  return Boolean((min && parseIso(min) && iso < min) || (max && parseIso(max) && iso > max));
}

export type CalendarCell = { iso: string; day: number; inMonth: boolean };

/** The month as full weeks (Sunday first), 5 or 6 rows of 7, with the days of the neighbouring months filling the gaps. */
export function monthGrid(year: number, month: number): CalendarCell[][] {
  const lead = firstWeekday(year, month);
  const first = toIso(year, month, 1);
  const total = Math.ceil((lead + daysInMonth(year, month)) / 7) * 7;
  const rows: CalendarCell[][] = [];
  for (let i = 0; i < total; i++) {
    const iso = addDays(first, i - lead);
    const p = parseIso(iso)!;
    const cell = { iso, day: p.day, inMonth: p.month === month && p.year === year };
    if (i % 7 === 0) rows.push([]);
    rows[rows.length - 1].push(cell);
  }
  return rows;
}

/** "November 2026" */
export function monthTitle(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** "Sunday, November 15, 2026" for screen readers. */
export function longDate(iso: string): string {
  const p = parseIso(iso);
  if (!p) return iso;
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return `${weekday}, ${MONTH_NAMES[p.month - 1]} ${p.day}, ${p.year}`;
}
