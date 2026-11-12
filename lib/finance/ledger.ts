export type LedgerEntry = {
  amount: number;
  direction: "in" | "out";
  /** Non-cash memo (e.g. capitalized interest): shown in the ledger, never moves cash. */
  is_memo?: boolean;
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
    if (entry.is_memo) continue;
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
    if (!entry.is_memo) balance += entry.direction === "in" ? entry.amount : -entry.amount;
    return round2(balance);
  });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------- CL1 (Nov 12, migration 0055): the Cash & ledger page ----------
// The totals and the running balance now come from the database (cash_ledger_page), added up with exact decimal
// numbers over the whole ledger. The helpers below only decide what the screen shows; they do no money maths.

// one entry on the page, as cash_ledger_page returns it
export type LedgerRow = {
  id: string;
  created_at: string;
  entry_type: string; // loan_disbursement, payment_received, expense, revenue, forfeiture, adjustment, capitalization
  direction: "in" | "out";
  amount: number;
  is_memo: boolean; // a non-cash memo (capitalization): listed, never counted as cash
  description: string | null;
  balance: number; // the ledger balance right after this entry
  related_loan_id: string | null;
  ticket_number: string | null;
  customer_name: string | null;
  created_by_name: string | null;
  receipt_number: string | null; // "RC-...", when the description has one
  manual: boolean; // typed in by staff (not made by a loan, payment or sale)
  no_sale_record: boolean; // auction-sale money whose item has no sale record
  edits: { at: string; by: string | null; reason: string | null; before: string | null; after: string | null }[]; // Admin corrections
};
export type LedgerSummary = {
  today: string; // the Manila date the "today" totals are for
  today_in: number;
  today_out: number;
  today_noncash: number;
  balance: number;
  entries: number;
  under_review: boolean; // FC1: does the balance include entries that are under review? (every role that sees the ledger)
  changes_locked: boolean; // LK1 (0058): Correct, Archive and Restore of ledger entries are switched off for every role
  archived: number; // FC1: how many entries are archived (not listed, not counted)
  check_count: number | null; // only an Admin gets these two
  check_sum: number | null;
};
export type LedgerPage = { summary: LedgerSummary; total: number; sum_in: number; sum_out: number; page: number; size: number; rows: LedgerRow[] };

// the names of the entry types, as staff say them
export const ENTRY_TYPES: { value: string; label: string }[] = [
  { value: "loan_disbursement", label: "Loan disbursement" }, // FC1: not "Loan released", which sounds like releasing the jewelry
  { value: "payment_received", label: "Payment received" },
  { value: "expense", label: "Expense" },
  { value: "revenue", label: "Revenue" },
  { value: "adjustment", label: "Adjustment" },
  { value: "capitalization", label: "Capitalization" },
  { value: "forfeiture", label: "Forfeiture" },
];
export const entryTypeLabel = (t: string) => ENTRY_TYPES.find((x) => x.value === t)?.label ?? t.replace(/_/g, " ");

// what kind of movement an entry is. A memo is "noncash" whatever its direction says.
export const movementOf = (e: Pick<LedgerRow, "direction" | "is_memo">): "in" | "out" | "noncash" => (e.is_memo ? "noncash" : e.direction);
export const MOVEMENT_LABEL = { in: "Cash in", out: "Cash out", noncash: "No cash movement" } as const;

// A short description for the list. The long ticket and receipt numbers are shown on their own line, so they are
// taken out of the sentence here ("Payment RC-2026... for PT-2026..." -> "Payment"). The full text stays in Details.
export function shortDescription(e: Pick<LedgerRow, "description" | "entry_type">): string {
  const full = (e.description ?? "").trim();
  if (!full) return entryTypeLabel(e.entry_type);
  const short = full
    .replace(/\bRC-[0-9]+-[0-9A-Za-z]+\b/g, "") // receipt numbers
    .replace(/\bPT-[0-9A-Za-z]+(-[0-9A-Za-z]+)*\b/g, "") // ticket numbers
    .replace(/\s+(for|of|from|to)(\s+(loan|ticket|the item))?\s*(?=[:.,]|$)/gi, "") // "for", "of ticket" left hanging
    .replace(/\s+(for|of|from)\s+(loan|ticket)\s*:/gi, ":")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([:.,])/g, "$1")
    .trim();
  return short.length >= 3 ? short : full;
}

// The filters in the page address (?q=&type=&flow=&source=&from=&to=&check=1), cleaned. Anything unknown is dropped,
// so a typed address can't ask the database for something odd.
export type LedgerFilters = { q: string; type: string; flow: string; source: string; from: string; to: string; check: boolean };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function ledgerFilters(sp: Record<string, string | undefined>): LedgerFilters {
  const from = ISO_DATE.test(sp.from ?? "") ? (sp.from as string) : "";
  let to = ISO_DATE.test(sp.to ?? "") ? (sp.to as string) : "";
  if (from && to && to < from) to = from; // a range typed backwards = that one day
  return {
    q: (sp.q ?? "").trim().slice(0, 80),
    type: ENTRY_TYPES.some((t) => t.value === sp.type) ? (sp.type as string) : "",
    flow: ["in", "out", "noncash"].includes(sp.flow ?? "") ? (sp.flow as string) : "",
    source: ["manual", "system"].includes(sp.source ?? "") ? (sp.source as string) : "",
    from,
    to,
    check: sp.check === "1",
  };
}
export const hasFilters = (f: LedgerFilters) => Boolean(f.q || f.type || f.flow || f.source || f.from || f.to || f.check);
