// RP1 (Nov 12): small helpers shared by the six reports, in one place so they can be tested.
// Nothing here changes a record.
//
// RP9 (Nov 12): the reports no longer read every row into the server and add them up there.
// Before: each report asked the database for 1,000 rows at a time until it had all of them (up to 100,000),
// then counted, totalled and paged them in TypeScript. That gave correct totals, but the work grew with every
// loan and ledger entry, and a big shop would send thousands of rows to the server on every page view.
// Now: the database does the counting, the totals and the paging (migration 0066: report_loans,
// report_inventory_aging, report_loan_analytics, report_cash_breakdown, audit_log_page). Each page receives
// only its 50 rows plus the totals of ALL matching records. The rules (paid, overdue, grace, age groups,
// Manila days) live in those functions and are checked by ctm_selftest_0066.

// rows per page on screen, and the most rows one "Show all on one page (for printing)" can hold
export const REPORT_PAGE_SIZE = 50;
export const PRINT_LIMIT = 1000; // the database functions refuse to send more than this in one request

/** The data of a database report function, or a thrown error (the page then shows the normal error screen). */
export function reportData<T>({ data, error }: { data: unknown; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

// ---------- loans (report_loans) ----------

// Outstanding loans: where each open loan stands today, with the same words as the Loans page
export type LoanSituation = "overdue" | "due_soon" | "not_due" | "paid";
export const LOAN_SITUATIONS: Record<LoanSituation, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  not_due: "Not due yet",
  paid: "Paid, ready to release",
};

// OL2 (Nov 13): the Outstanding report's views. "Owes money" = Overdue + Due soon + Not due yet (database filter
// 'owing', migration 0069); "Ready to release" = open loans that owe nothing yet (not redeemed, item not released).
export type OutstandingView = LoanSituation | "owing";
export const OUTSTANDING_VIEWS: Record<OutstandingView, string> = {
  owing: "Owes money",
  overdue: "Overdue",
  due_soon: "Due soon",
  not_due: "Not due yet",
  paid: "Ready to release",
};

// OL3 (Nov 13): the sort orders the database understands (report_loans p_sort, migration 0069)
export type LoanSort = "due" | "due_desc" | "owed_desc" | "owed" | "customer" | "ticket";
export const LOAN_SORTS: Record<LoanSort, string> = {
  due: "Due date (earliest first)",
  due_desc: "Due date (latest first)",
  owed_desc: "Owed now (highest first)",
  owed: "Owed now (lowest first)",
  customer: "Customer (A to Z)",
  ticket: "Ticket number",
};

// Overdue loans: how far along each one is. A fully paid loan is never here (Loans page rule).
export type OverdueStage = "in_grace" | "past_grace" | "defaulted";
export const OVERDUE_STAGES: Record<OverdueStage, string> = {
  in_grace: "In grace period",
  past_grace: "Past grace, pending default", // OV2 (Nov 13): was "Past grace (not marked Defaulted yet)"
  defaulted: "Defaulted",
};

// OV5 (Nov 13): the Overdue report's sort orders. They use the same database sorts as Outstanding loans (p_sort,
// migration 0069): "most days overdue" is the earliest due date first, so no new database work was needed.
export type OverdueSort = "due" | "due_desc" | "owed_desc" | "owed" | "customer" | "ticket";
export const OVERDUE_SORTS: Record<OverdueSort, string> = {
  // short words so the chosen sort shows in full in the Sort by box on a 1366px laptop
  due: "Most days overdue",
  due_desc: "Fewest days overdue",
  owed_desc: "Highest owed now",
  owed: "Lowest owed now",
  customer: "Customer (A to Z)",
  ticket: "Ticket number",
};

/** One loan row from report_loans (worked out by the database for today's Manila date). */
export type ReportLoanRow = {
  id: string;
  ticket_number: string;
  principal_amount: number;
  principal_balance: number;
  maturity_date: string;
  status: string; // active / extended (Renewed) / reinstated / defaulted
  grace_period_days: number;
  owed: number; // owed now: principal left + interest including after the due date (owed_now, same as the Loans page)
  interest_now: number; // owed minus principal left
  customer_id: string | null; // OL4 (0069): so the customer's name can link to their page
  customer_name: string | null;
  customer_no: number | null;
  contact_number: string | null;
  category: string | null;
  category_other: string | null;
  karat: number | null;
  days_late: number; // today minus the due date (negative = not due yet)
  grace_end: string; // due date + grace days
  situation: LoanSituation | null; // null for a defaulted loan
  stage: OverdueStage | null; // null when the loan isn't overdue
};

/** What report_loans sends back: counts and sums of ALL loans in the report, totals of all MATCHING loans, one page of rows. */
export type ReportLoans = {
  today: string;
  counts: Record<string, number> | null; // per situation (Outstanding) or per stage (Overdue), before search and filter
  sums: Record<string, number> | null; // owed now per situation / stage
  all_count: number;
  all_owed: number;
  all_totals?: { principal: number; balance: number; interest: number; owed: number }; // OL1 (0069): every loan in the report, before search and filters
  paid_past_due: number; // past the due date but fully paid (they are not overdue)
  total: number; // loans matching the search and filter
  totals: { principal: number; balance: number; interest: number; owed: number };
  page: number; // the page actually shown (a page past the end shows the last page)
  size: number;
  rows: ReportLoanRow[];
};

// ---------- inventory (report_inventory_aging) ----------

// Inventory aging: the age groups, in days held (Manila calendar days, the same count as the Inventory page)
export type AgeBand = "0_30" | "31_60" | "61_90" | "over_90";
export const AGE_BANDS: Record<AgeBand, string> = { "0_30": "0–30 days", "31_60": "31–60 days", "61_90": "61–90 days", over_90: "Over 90 days" };

export type CustodyGroup = "vault" | "forfeited" | "auction";
export type ReportInventory = {
  today: string;
  all_count: number; // every item still in the shop
  aged_count: number; // held over 60 days
  custody_counts: Partial<Record<CustodyGroup, number>> | null;
  band_counts: Partial<Record<AgeBand, number>> | null; // inside the custody filter picked
  total: number;
  page: number;
  size: number;
  rows: {
    id: string;
    vault_location: string;
    status: "pawned" | "extended" | "forfeited" | "queued_for_auction";
    created_at: string;
    received: string; // the Manila date the item came in
    days: number; // days held
    custody: CustodyGroup;
    band: AgeBand;
    appraisal_no: number | null;
    category: string | null;
    category_other: string | null;
    karat: number | null;
    weight_grams: number | null;
    customer_name: string | null;
  }[];
};

// ---------- trends (report_loan_analytics) ----------

export type ReportAnalytics = {
  today: string;
  total: number; // loans that aren't archived
  principal_sum: number;
  by_status: Record<string, number>;
  months: { month: string; count: number; totalPrincipal: number }[]; // the last 12 calendar months, oldest first, empty months included
};

/**
 * The PB-39 numbers worked out from the counts per status (DECISIONS_LOG.md):
 * concluded = redeemed + defaulted + forfeited; redemption rate = redeemed / concluded;
 * forfeiture rate = (defaulted + forfeited) / concluded; average loan = all principal / all loans.
 * A rate is 0 when nothing has concluded yet (no division by zero).
 */
export function portfolioRates(byStatus: Record<string, number>, total: number, principalSum: number) {
  const n = (s: string) => Number(byStatus[s] ?? 0);
  const redeemed = n("redeemed");
  const lost = n("defaulted") + n("forfeited");
  const concluded = redeemed + lost;
  return {
    redeemed,
    defaulted: n("defaulted"),
    forfeited: n("forfeited"),
    concluded,
    running: total - concluded, // active, renewed or reinstated
    redemptionRate: concluded ? round4(redeemed / concluded) : 0,
    forfeitureRate: concluded ? round4(lost / concluded) : 0,
    averageLoan: total ? Math.round((principalSum / total) * 100) / 100 : 0,
  };
}

// ---------- cash (report_cash_breakdown) ----------

export type ReportCash = {
  entries: number; // every ledger entry of the period (cash and non-cash)
  cash_in: number;
  cash_out: number;
  non_cash_count: number; // capitalized interest: written down, but no money moved
  non_cash_amount: number;
  by_type: { entry_type: string; count: number; cash_in: number; cash_out: number }[];
};

// ---------- dates in the address ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A YYYY-MM-DD date from the address, or undefined if it isn't a real date. */
export function dateParam(v: string | undefined): string | undefined {
  if (!v || !DATE_RE.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? undefined : v; // refuses 2026-02-31
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

// AT8 (Nov 13): which page links to show for a long list: the first, the last, and two on each side of the open
// page, with "…" for the pages in between (1 … 4 5 [6] 7 8 … 1,139). A gap of one page shows that page instead.
export function pageWindow(page: number, pages: number): (number | "gap")[] {
  if (pages <= 1) return [1];
  const p = Math.min(Math.max(1, page), pages);
  const keep = new Set([1, pages, p - 2, p - 1, p, p + 1, p + 2].filter((n) => n >= 1 && n <= pages));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  for (const n of sorted) {
    const prev = out.length ? (out[out.length - 1] as number) : 0;
    if (n - prev === 2) out.push(n - 1); // skipping exactly one page: show it
    else if (n - prev > 2) out.push("gap");
    out.push(n);
  }
  return out;
}
