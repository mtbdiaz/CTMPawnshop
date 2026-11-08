// PB-33: a loan is due for a reminder once its maturity date is within the
// lead window and hasn't already had a reminder logged.
export const REMINDER_LEAD_DAYS = 3;

function toDay(value: Date | string): number {
  const iso = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

/**
 * Whole calendar days until maturity (0 = due today). Compared by date, not
 * timestamp — a loan due today must stay on the list for the entire day.
 * Pass `today` as the shop's (Manila) calendar date.
 */
export function daysUntilDue(maturityDate: Date | string, today: Date | string): number {
  return Math.round((toDay(maturityDate) - toDay(today)) / 86_400_000);
}

export function isDueForReminder(maturityDate: Date | string, today: Date | string = new Date()): boolean {
  const days = daysUntilDue(maturityDate, today);
  return days >= 0 && days <= REMINDER_LEAD_DAYS;
}

// ---------- R1: Reminders page helpers (dates use the shop's Manila calendar day, YYYY-MM-DD) ----------

/** Adds whole days to a YYYY-MM-DD date. Works across month and year ends (Dec 31 + 1 = Jan 1). */
export function addDays(date: string, days: number): string {
  const d = new Date(toDay(date) + days * 86_400_000); // toDay = midnight UTC of that date, so no timezone shift
  return d.toISOString().slice(0, 10); // back to YYYY-MM-DD
}

/** The last due date on the Reminders list: today + 3 days (inclusive). */
export function reminderWindowEnd(today: string): string {
  return addDays(today, REMINDER_LEAD_DAYS);
}

// the "Due" dropdown on the Reminders page
export type DueFilter = "all" | "today" | "tomorrow" | "later";
export const DUE_FILTERS: DueFilter[] = ["all", "today", "tomorrow", "later"];

/** First and last due date (inclusive) for a "Due" dropdown choice. */
export function dueRange(filter: DueFilter, today: string): [string, string] {
  if (filter === "today") return [today, today];
  if (filter === "tomorrow") return [addDays(today, 1), addDays(today, 1)];
  if (filter === "later") return [addDays(today, 2), reminderWindowEnd(today)]; // in 2 to 3 days
  return [today, reminderWindowEnd(today)]; // all = today up to 3 days from now
}

/** Short words for how soon a loan is due: "Due today", "Due tomorrow", "Due in 3 days". */
export function dueLabel(daysLeft: number): string {
  if (daysLeft === 0) return "Due today";
  if (daysLeft === 1) return "Due tomorrow";
  return `Due in ${daysLeft} days`;
}

/**
 * The first day a contact log counts for this due date: 3 days before it, when the loan first shows on the list.
 * A log from before that day belongs to an EARLIER due date (the loan was renewed since), so it doesn't count now.
 */
export function cycleStart(maturityDate: string): string {
  return addDays(maturityDate, -REMINDER_LEAD_DAYS);
}

/** The Manila calendar day (YYYY-MM-DD) of a saved time, e.g. 2026-11-07T16:30:00Z is Nov 8 in Manila. */
export function manilaDateOf(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); // en-CA = YYYY-MM-DD
}

/** Only the logs made for THIS due date, newest first. */
export function logsThisCycle<L extends { sent_at: string }>(logs: L[], maturityDate: string): L[] {
  const start = cycleStart(maturityDate);
  return logs.filter((l) => manilaDateOf(l.sent_at) >= start).sort((a, b) => b.sent_at.localeCompare(a.sent_at)); // ISO times sort as text
}
