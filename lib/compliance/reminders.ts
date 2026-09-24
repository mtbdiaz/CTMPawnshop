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
