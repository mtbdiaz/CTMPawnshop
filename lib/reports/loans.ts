// PB-35: days a loan has been overdue past its maturity date.
export function daysOverdue(maturityDate: Date, now: Date = new Date()): number {
  const diff = Math.floor((now.getTime() - maturityDate.getTime()) / 86_400_000);
  return Math.max(0, diff);
}

// PB-36: days an item has been sitting in the vault.
export function daysInVault(sinceDate: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - sinceDate.getTime()) / 86_400_000));
}
