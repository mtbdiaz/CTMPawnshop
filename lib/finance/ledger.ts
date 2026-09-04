export type LedgerEntry = {
  amount: number;
  direction: "in" | "out";
};

// PB-28: running cash position — net of all "in" vs "out" entries.
export function computeCashPosition(entries: LedgerEntry[]): {
  totalIn: number;
  totalOut: number;
  net: number;
} {
  let totalIn = 0;
  let totalOut = 0;
  for (const entry of entries) {
    if (entry.direction === "in") totalIn += entry.amount;
    else totalOut += entry.amount;
  }
  return { totalIn: round2(totalIn), totalOut: round2(totalOut), net: round2(totalIn - totalOut) };
}

// PB-30: chronological running balance for the formal ledger view.
// Entries must already be in chronological order (oldest first).
export function computeRunningBalances(entries: LedgerEntry[]): number[] {
  let balance = 0;
  return entries.map((entry) => {
    balance += entry.direction === "in" ? entry.amount : -entry.amount;
    return round2(balance);
  });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
