// PB-33: a loan is due for a reminder once its maturity date is within the
// lead window and hasn't already had a reminder logged.
export const REMINDER_LEAD_DAYS = 3;

export function isDueForReminder(maturityDate: Date, now: Date = new Date()): boolean {
  const leadStart = new Date(now);
  leadStart.setDate(leadStart.getDate() + REMINDER_LEAD_DAYS);
  return maturityDate <= leadStart && maturityDate >= now;
}
