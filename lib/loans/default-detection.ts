// PB-21: a loan defaults once it's past both its maturity date and its
// configured grace period, with no redemption or extension in that window.
export function isPastGracePeriod(maturityDate: Date, gracePeriodDays: number, now: Date = new Date()): boolean {
  const deadline = new Date(maturityDate);
  deadline.setDate(deadline.getDate() + gracePeriodDays);
  return now.getTime() > deadline.getTime();
}
