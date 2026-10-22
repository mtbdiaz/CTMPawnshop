// "use server" = these functions run on the server, but the browser can call them like normal functions
"use server";

// the Supabase client that uses the logged-in user's session (database rules still apply)
import { createClient } from "@/lib/supabase/server";
// checks the user is logged in and has one of the allowed roles
import { requireRole } from "@/lib/auth/require-role";
// the SAME customer ranking the New loan search uses (already unit-tested), so results are consistent
import { rankCustomers } from "@/lib/customers/search";
// interest that piled up after the due date (same math as the Dashboard and loan page)
import { accruedInterest } from "@/lib/loans/accrual";
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
    if (days < 0) return { badge: { status: "defaulted", label: "Overdue" }, action: "View loan" }; // red
    if (days <= 7) return { badge: { status: "pending", label: "Due soon" }, action: "View loan" }; // amber
    if (l.status === "extended") return { badge: { status: "extended", label: "Renewed" }, action: "View loan" }; // gold
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

  const supabase = await createClient(); // database, as the logged-in user
  const today = manilaToday(); // today's date in Manila

  // ---------- 1. Customers + loans by ticket + payments by receipt (all at the same time) ----------
  const [{ data: customerRows }, { data: ticketLoans }, { data: paymentRows }] = await Promise.all([
    // customers whose name, phone or ID number contains the text
    supabase
      .from("customers")
      .select("id, full_name, contact_number, id_number")
      .is("archived_at", null)
      .or(
        [`full_name.ilike.%${safe}%`, `contact_number.ilike.%${phone}%`, `id_number.ilike.%${safe}%`]
          .concat(compact !== safe ? [`id_number.ilike.%${compact}%`] : [])
          .join(","),
      )
      .limit(40),
    // loans whose ticket number contains the text
    supabase
      .from("loans")
      .select("id, ticket_number, status, maturity_date, principal_balance, interest_owed, interest_rate_percent, interest_accrued_through, customers(full_name)")
      .is("archived_at", null)
      .ilike("ticket_number", `%${ref}%`)
      .order("created_at", { ascending: false })
      .limit(10),
    // payments whose receipt number contains the text (receipts look like RC-20261019...)
    supabase
      .from("loan_payments")
      .select("id, receipt_number, amount, created_at, loans(id, ticket_number, customers(full_name))")
      .is("archived_at", null)
      .ilike("receipt_number", `%${ref}%`)
      .order("created_at", { ascending: false })
      .limit(4),
  ]);

  // best customer matches first (name starts with it > a word starts with it > phone/ID > contains)
  // (a +63 phone number is ranked using its 09... form, the way it is saved)
  const customers = rankCustomers(customerRows ?? [], phone !== compact ? phone : q, 4);
  const customerIds = customers.map((c) => c.id);

  // ---------- 2. Loans of those customers + how many open loans each has ----------
  const [{ data: customerLoans }] = await Promise.all([
    customerIds.length
      ? supabase
          .from("loans")
          .select("id, ticket_number, status, maturity_date, principal_balance, interest_owed, interest_rate_percent, interest_accrued_through, customer_id, customers(full_name)")
          .is("archived_at", null)
          .in("customer_id", customerIds)
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  // the loan shape we use below
  type LoanRow = {
    id: string;
    ticket_number: string;
    status: string;
    maturity_date: string;
    principal_balance: number;
    interest_owed: number;
    interest_rate_percent: number;
    interest_accrued_through: string | null;
    customer_id?: string;
    customers: { full_name: string } | null;
  };
  const byCustomer = (customerLoans ?? []) as unknown as LoanRow[];

  // open loans per customer, for "2 open loans" under each customer
  const openCount = new Map<string, number>();
  for (const l of byCustomer) if (l.customer_id && OPEN.has(l.status)) openCount.set(l.customer_id, (openCount.get(l.customer_id) ?? 0) + 1);

  // ---------- 3. Rank loans: exact ticket > ticket starts with > ticket contains > the customer's loans ----------
  const lower = ref.toLowerCase();
  const rank = (l: LoanRow) => {
    const t = l.ticket_number.toLowerCase();
    if (t === lower) return 0; // exact ticket number
    if (t.startsWith(lower)) return 1; // ticket starts with the text
    if (t.includes(lower)) return 2; // ticket contains the text
    return 3; // found through the customer's name
  };
  const seen = new Set<string>(); // so a loan found both ways is listed once
  const loanRows = [...((ticketLoans ?? []) as unknown as LoanRow[]), ...byCustomer]
    .filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)))
    .sort((a, b) => rank(a) - rank(b)) // stable sort: keeps newest-first inside each rank
    .slice(0, 5);

  const loans: SearchHit[] = loanRows.map((l) => {
    // what the customer owes today (0 once it is closed)
    const owed = OPEN.has(l.status) || l.status === "defaulted" ? Number(l.principal_balance) + accruedInterest(l, today).interestOwed : 0;
    const s = loanStatus(l, owed, today);
    return {
      id: l.id,
      title: l.ticket_number,
      subtitle: `${l.customers?.full_name ?? ""} · ${formatPeso(owed)} owed · due ${formatDate(l.maturity_date)}`,
      href: `/dashboard/loans/${l.id}`,
      action: s.action,
      badge: s.badge,
    };
  });

  const customerHits: SearchHit[] = customers.map((c) => {
    const n = openCount.get(c.id) ?? 0; // open loans of this customer
    return {
      id: c.id,
      title: c.full_name,
      subtitle: `${c.contact_number} · ${n} open loan${n === 1 ? "" : "s"}`,
      href: `/dashboard/customers/${c.id}`,
      action: "View profile",
    };
  });

  // ---------- 4. Appraisals: by category word ("ring", "necklace"), karat ("18k") or the custom name of "Others" ----------
  const words = q.toLowerCase().split(" ");
  const karatMatch = q.match(/\b(18|21|24)\s*k\b/i); // e.g. "18k" or "24 K"
  const karat = karatMatch ? Number(karatMatch[1]) : null;
  // categories whose name (or one of the extra words) appears in what was typed
  const categories = ITEM_CATEGORIES.filter((c) =>
    words.some((w) => w.length >= 3 && (c.label.toLowerCase().startsWith(w) || c.value.startsWith(w) || CATEGORY_WORDS[w] === c.value)),
  ).map((c) => c.value);
  // the text without the karat part, for searching the custom "Others" name
  const otherText = safe.replace(/\b(18|21|24)\s*k\b/i, "").trim();

  let appraisals: SearchHit[] = [];
  if (categories.length || karat || otherText.length >= 3) {
    let aq = supabase
      .from("appraisal_items")
      .select("id, category, category_other, karat, weight_grams, computed_value, status, customers(full_name)")
      .is("archived_at", null);
    if (karat) aq = aq.eq("karat", karat); // only that karat
    const ors = [
      ...(categories.length ? [`category.in.(${categories.join(",")})`] : []),
      ...(otherText.length >= 3 ? [`category_other.ilike.%${otherText}%`] : []),
    ];
    if (ors.length) aq = aq.or(ors.join(",")); // category OR custom name (if only a karat was typed, karat alone filters)
    const { data: apprRows } = await aq.order("created_at", { ascending: false }).limit(4);
    type ApprRow = { id: string; category: string; category_other: string | null; karat: number; weight_grams: number; computed_value: number; status: string; customers: { full_name: string } | null };
    appraisals = ((apprRows ?? []) as unknown as ApprRow[]).map((a) => ({
      id: a.id,
      title: `${categoryLabel(a.category, a.category_other)}, ${a.karat}K, ${a.weight_grams} g`,
      subtitle: `${formatPeso(a.computed_value)} value${a.customers?.full_name ? ` · ${a.customers.full_name}` : ""}`,
      href: `/dashboard/appraisals/${a.id}`,
      action: "View appraisal",
      badge: { status: a.status, label: a.status === "pawned" ? "Pawned" : "Available" },
    }));
  }

  // ---------- 5. Payments: open the loan they belong to (there is no separate payment page) ----------
  type PayRow = { id: string; receipt_number: string; amount: number; created_at: string; loans: { id: string; ticket_number: string; customers: { full_name: string } | null } | null };
  const payments: SearchHit[] = ((paymentRows ?? []) as unknown as PayRow[]).map((p) => ({
    id: p.id,
    title: p.receipt_number,
    subtitle: `${formatPeso(p.amount)} · ${formatDate(p.created_at)} · ${p.loans?.customers?.full_name ?? ""} · ${p.loans?.ticket_number ?? ""}`,
    href: p.loans ? `/dashboard/loans/${p.loans.id}` : "/dashboard/loans",
    action: "View loan",
  }));

  return { customers: customerHits, loans, appraisals, payments };
}