// "use server" = these functions run on the server, but the browser can call them like normal functions
"use server";

// the Supabase client that uses the logged-in user's session (database rules still apply)
import { appraisalNo, customerNo, parseRefNo } from "@/lib/ref-numbers"; // #18 + #29: short numbers
import { createClient } from "@/lib/supabase/server";
// checks the user is logged in and has one of the allowed roles
import { requireRole } from "@/lib/auth/require-role";
// interest that piled up after the due date (same math as the Dashboard and loan page)
import { owedNow } from "@/lib/loans/status"; // LD (0073): principal + interest + liquidated damages
// "how many days until this date" (negative = in the past)
import { daysUntilDue } from "@/lib/compliance/reminders";
// turns "ring" into "Ring", and the list of item categories
import { categoryLabel, ITEM_CATEGORIES } from "@/lib/appraisal/valuation";
// peso and date formatting used everywhere else, and today's date in Manila
import { formatDate, formatPeso, manilaToday } from "@/lib/format";

// One row in the preview list
export type SearchHit = {
  id: string; // database id (used as the key)
  title: string; // main text (name, ticket, item, receipt)
  subtitle: string; // small text under it
  // QS1 (Nov 14, Page 11): optional third line that is never cut off. Loans use it for "₱X owed · due <full date>".
  detail?: string;
  href: string; // the page that opens when picked
  action: string; // what the row says it will do, e.g. "Review release"
  badge?: { status: string; label: string }; // optional status badge (status picks the colour, label is the word)
};

// The answer: results grouped by kind. An empty group is simply not shown.
export type SearchResults = {
  customers: SearchHit[];
  loans: SearchHit[];
  appraisals: SearchHit[];
  payments: SearchHit[];
  limited?: boolean; // #22: true = too many searches this minute, so the server didn't search
};

// Loan statuses that are still open (not redeemed, defaulted or forfeited)
const OPEN = new Set(["active", "extended", "reinstated"]);

// Extra words staff might type for a category, e.g. "necklace" means the "chain" category
const CATEGORY_WORDS: Record<string, string> = {
  necklace: "chain",
  kwintas: "chain",
  earring: "earrings",
  hikaw: "earrings",
  singsing: "ring",
  pulseras: "bracelet",
};

// The loan's status in the SAME words the Dashboard uses, plus the action it leads to.
// "status" here is only for the badge colour (it reuses the app's existing colours).
function loanStatus(l: { status: string; maturity_date: string }, owed: number, today: string) {
  if (OPEN.has(l.status)) {
    if (owed < 0.01) return { badge: { status: "redeemed", label: "Paid, ready to release" }, action: "Review release" }; // green
    const days = daysUntilDue(l.maturity_date, today); // days until due (negative = late)
    if (days < 0) return { badge: { status: "pending", label: "Overdue" }, action: "View loan" }; // L26: amber
    if (days <= 7) return { badge: { status: "pending", label: "Due soon" }, action: "View loan" }; // amber
    if (l.status === "extended") return { badge: { status: "extended", label: "Renewed" }, action: "View loan" }; // L26: blue
    if (l.status === "reinstated") return { badge: { status: "reinstated", label: "Reinstated" }, action: "View loan" };
    return { badge: { status: "active", label: "Active" }, action: "View loan" }; // blue
  }
  if (l.status === "defaulted") return { badge: { status: "defaulted", label: "Forfeit pending" }, action: "Review forfeit" };
  if (l.status === "redeemed") return { badge: { status: "neutral", label: "Redeemed" }, action: "View loan" }; // grey = closed
  return { badge: { status: "neutral", label: "Forfeited" }, action: "View loan" }; // grey = closed
}

// Smart global search for the Dashboard: customers, loans, appraisals and payments.
// Read-only: it only finds records, it never changes anything.
export async function quickSearch(query: string): Promise<SearchResults> {
  // every staff role may search (Admin always passes); this also blocks logged-out users
  await requireRole(["cashier", "operator", "appraiser", "admin"]);

  // the empty answer, used when there is nothing to search
  const empty: SearchResults = { customers: [], loans: [], appraisals: [], payments: [] };

  // clean the text: trim the ends and turn repeated spaces into one
  const q = query.trim().replace(/\s+/g, " ");
  if (q.length < 2) return empty; // too short to be useful
  // remove characters that have a special meaning in the database filter, and cap the length
  const safe = q.replace(/[%,()*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (safe.length < 2) return empty;

  // Philippine mobile formats: "+639171234567" and "639171234567" become "09171234567"
  // (that's how numbers are saved). Spaces and dashes are ignored for phone/ID matching.
  const compact = safe.replace(/[\s-]/g, "");
  const phone = /^\+?63(9\d{9})$/.test(compact) ? `0${compact.replace(/^\+?63/, "")}` : compact;
  // ticket and receipt numbers keep their dashes (PT-SEED-04, RC-2026...), only spaces are removed
  const ref = safe.replace(/\s/g, "");
  // #18 + #29: "C-0012" or "A-0045" = exactly that customer or appraisal
  const shortNo = parseRefNo(q);

  const today = manilaToday(); // today's date in Manila

  // What the text says about an item: a category word ("ring", "necklace"), a karat ("18k") or the custom "Others" name.
  // The database does the searching; the words are read here so the list of categories stays in one place.
  const words = q.toLowerCase().split(" ");
  const karatMatch = q.match(/\b(18|21|24)\s*k\b/i); // e.g. "18k" or "24 K"
  const karat = karatMatch ? Number(karatMatch[1]) : null;
  const categories = ITEM_CATEGORIES.filter((c) =>
    words.some((w) => w.length >= 3 && (c.label.toLowerCase().startsWith(w) || c.value.startsWith(w) || CATEGORY_WORDS[w] === c.value)),
  ).map((c) => c.value);
  const otherText = safe.replace(/\b(18|21|24)\s*k\b/i, "").trim(); // the text without the karat part
  const wantAppraisals = shortNo?.kind === "A" || categories.length > 0 || karat !== null || otherText.length >= 3;

  // ONE call to the database (migration 0076, quick_search). It checks the role, counts this search against the
  // 60 a minute limit (#22), finds customers (best 4, same ranking as lib/customers/search.ts, or up to 3 similar
  // names when nothing matches), their loans and the loans with this ticket number, receipts and appraisals.
  // Before, this was 6 to 8 separate calls one after another, and with the server far from the database each one
  // added a noticeable wait. Full ID numbers are searched inside the database and never come back.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quick_search", {
    p_q: q,
    p_safe: safe,
    p_compact: compact,
    p_phone: phone,
    p_ref: ref,
    p_rank_q: phone !== compact ? phone : q, // a +63 phone number is ranked using its 09... form, the way it is saved
    p_short_kind: shortNo?.kind,
    p_short_n: shortNo?.n,
    p_categories: categories,
    p_karat: karat ?? undefined,
    p_other: otherText,
    p_appr: wantAppraisals,
  });
  if (error || !data) {
    console.error("quick_search failed:", error?.message); // details stay in the server log
    throw new Error("Search failed"); // the search box shows its friendly "couldn't search" message
  }
  const found = data as unknown as QuickSearchAnswer;
  if (found.limited) return { ...empty, limited: true }; // #22: the server says "slow down" instead of searching

  const loans: SearchHit[] = found.loans.map((l) => {
    // what the customer owes today (0 once it is closed)
    const owed = OPEN.has(l.status) || l.status === "defaulted" ? owedNow(l, today) : 0;
    const s = loanStatus(l, owed, today);
    return {
      id: l.id,
      title: l.ticket_number,
      // QS1: the name is the second line and the amount + full due date get their own third line.
      subtitle: l.customer_name ?? "",
      detail: `${formatPeso(owed)} owed · due ${formatDate(l.maturity_date)}`,
      href: `/dashboard/loans/${l.id}`,
      action: s.action,
      badge: s.badge,
    };
  });

  const customers: SearchHit[] = found.customers.map((c) => ({
    id: c.id,
    title: c.full_name,
    // #18: the short number. #16: "Similar name" in front when this is a close match, not an exact one
    subtitle: `${c.similar ? "Similar name · " : ""}${customerNo(c.customer_no)} · ${c.contact_number} · ${c.open_loans} open loan${c.open_loans === 1 ? "" : "s"}`,
    href: `/dashboard/customers/${c.id}`,
    action: "View profile",
  }));

  const appraisals: SearchHit[] = found.appraisals.map((a) => ({
    id: a.id,
    title: `${categoryLabel(a.category, a.category_other)}, ${a.karat}K, ${a.weight_grams} g`,
    subtitle: `${appraisalNo(a.appraisal_no)} · ${formatPeso(a.computed_value)} value${a.customer_name ? ` · ${a.customer_name}` : ""}`,
    href: `/dashboard/appraisals/${a.id}`,
    action: "View appraisal",
    badge: { status: a.status, label: a.status === "pawned" ? "Pawned" : "Available" },
  }));

  // Payments open the loan they belong to (there is no separate payment page)
  const payments: SearchHit[] = found.payments.map((p) => ({
    id: p.id,
    title: p.receipt_number,
    subtitle: `${formatPeso(p.amount)} · ${formatDate(p.created_at)} · ${p.customer_name ?? ""} · ${p.ticket_number ?? ""}`,
    href: p.loan_id ? `/dashboard/loans/${p.loan_id}` : "/dashboard/loans",
    action: "View loan",
  }));

  return { customers, loans, appraisals, payments };
}

// The answer of quick_search (migration 0076)
type QuickSearchAnswer = {
  limited: boolean;
  customers: { id: string; customer_no: number; full_name: string; contact_number: string; similar: boolean; open_loans: number }[];
  loans: {
    id: string;
    ticket_number: string;
    status: string;
    maturity_date: string;
    principal_balance: number;
    interest_owed: number;
    interest_rate_percent: number;
    interest_accrued_through: string | null;
    grace_period_days: number;
    liquidated_damages_percent: number;
    damages_owed: number;
    damages_accrued_through: string | null;
    customer_name: string | null;
  }[];
  payments: { id: string; receipt_number: string; amount: number; created_at: string; loan_id: string | null; ticket_number: string | null; customer_name: string | null }[];
  appraisals: { id: string; appraisal_no: number; category: string; category_other: string | null; karat: number; weight_grams: number; computed_value: number; status: string; customer_name: string | null }[];
};
