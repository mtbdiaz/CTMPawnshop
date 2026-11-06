// Link = Next.js's clickable link (used for the tappable phone rows)
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
// ROLE_LABELS turns "appraiser" into "Appraiser" for display
import { hasRole, ROLE_LABELS } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { computeCashPosition } from "@/lib/finance/ledger";
import { daysUntilDue } from "@/lib/compliance/reminders";
import { formatDate, formatPeso, manilaDayStart, manilaToday } from "@/lib/format";
import { accruedInterest } from "@/lib/loans/accrual";
// categoryLabel turns "ring" into "Ring" (or the custom name for "others")
import { categoryLabel } from "@/lib/appraisal/valuation";
// isDueForReminder = due within the next 3 days (same rule the Reminders page uses)
import { isDueForReminder } from "@/lib/compliance/reminders";
import {
  Alert,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  SectionTitle,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  ActionsCell,
  ViewButton,
  cx, //  joins class names together, and can add some only when a condition is true
} from "@/components/ui";
// Icon = the small line icons already used in the sidebar (no extra library needed)
import { Icon } from "@/components/icons";
// QuickSearch = the search box with a live preview of matching customers and loans (quick-search.tsx)
import { QuickSearch } from "./quick-search";
// ListPager = the Previous / Page 1 of N / Next / See all bar under each list (list-pager.tsx)
import { ListPager } from "./list-pager";
 
export const metadata = { title: "Dashboard" };
 
// Pagination: how many loans each Dashboard list shows per page.
// Viewport fit: 3 when both lists show (Admin with loans waiting for forfeit), so both fit on a laptop screen.
// When Needs attention is the only list (Operator, Cashier, Appraiser), it gets 5 to use the free space.
const PAGE_SIZE = 3;
const PAGE_SIZE_ALONE = 5;
// Turns "?na=3" into a safe page number: at least 1, at most the last page, 1 if it's not a number
function pageNumber(raw: string | undefined, totalPages: number) {
  const n = Number.parseInt(raw ?? "1", 10); // "3" -> 3, "abc" -> NaN
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), totalPages) : 1; // keep it between 1 and the last page
}
 
type LoanRow = {
  id: string;
  ticket_number: string;
  maturity_date: string;
  principal_balance: number;
  interest_owed: number;
  interest_rate_percent: number;
  interest_accrued_through: string | null;
  status: string;
  customers: { full_name: string } | null;
};
 
// searchParams = the "?something=value" part of the address.
// "denied" = the no-access message. Pagination: "na" = Needs attention page, "wf" = Waiting for forfeit page.
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string; na?: string; wf?: string }> }) {
  // "await" waits for Next.js to finish reading the address
  const { denied, na, wf } = await searchParams;
  const user = await getCurrentUser();
  if (!user) return null;
  const role = user.profile.role;
  const supabase = await createClient();
 
  const canSeeCash = hasRole(role, ["operator", "cashier"]);
  // Roles: who can release (redeem) a paid item. Same rule as redeemLoan in loans/actions.ts (Cashier + Admin).
  const canRelease = hasRole(role, ["cashier"]);
 
  const [{ data: openLoans }, { data: todayCash }, { count: pendingFlags }, { count: openSuspicious }, { count: customerCount }] =
    await Promise.all([
      supabase
        .from("loans")
        .select("id, ticket_number, maturity_date, principal_balance, interest_owed, interest_rate_percent, interest_accrued_through, status, customers(full_name)")
        .in("status", ["active", "extended", "reinstated"])
        .is("archived_at", null)
        .order("maturity_date")
        .order("id"), // Pagination: same due date -> always the same order, so no loan shows on two pages
      canSeeCash
        ? supabase.from("cash_flow_entries").select("amount, direction, is_memo").is("archived_at", null).gte("created_at", manilaDayStart())
        : Promise.resolve({ data: [] as { amount: number; direction: "in" | "out"; is_memo: boolean }[] }),
      supabase
        .from("appraisal_items")
        .select("id", { count: "exact", head: true })
        .eq("is_counterfeit_risk", true)
        .eq("counterfeit_resolution", "pending")
        .is("archived_at", null),
      role === "admin"
        ? supabase.from("suspicious_activity_flags").select("id", { count: "exact", head: true }).eq("status", "open")
        : Promise.resolve({ count: 0 }),
      supabase.from("customers").select("id", { count: "exact", head: true }).is("archived_at", null),
    ]);
 
  const loans = (openLoans ?? []) as unknown as LoanRow[];
  const now = new Date();
  const today = manilaToday(now);
  // What the customer owes today: principal left + interest
  // (including interest that piled up after the due date).
  // Moved to the top so the lines below can use it.
  const owedNow = (l: LoanRow) => Number(l.principal_balance) + accruedInterest(l, today).interestOwed;
 
  // D1: a loan with nothing left to pay is "paid, ready to release".
  // We check "less than 1 centavo" instead of "equals 0" because
  // computers can leave tiny leftovers like 0.0000001 when adding decimals.
  const isPaid = (l: LoanRow) => owedNow(l) < 0.01;
 
  // All paid loans whose item is still in the vault
  const readyToRelease = loans.filter(isPaid);
 
  // Overdue = past the due date AND still owes money.
  // "!isPaid(l)" means "not paid" (the ! flips true/false).
  const overdue = loans.filter((l) => !isPaid(l) && daysUntilDue(l.maturity_date, today) < 0);
 
  // Due soon = due today or within 7 days, and still owes money
  const dueSoon = loans.filter((l) => {
    if (isPaid(l)) return false; // paid loans are never "due soon"
    const days = daysUntilDue(l.maturity_date, today);
    return days >= 0 && days <= 7;
  });
 
  // Total still owed across all open loans (paid ones add ₱0)
  const outstanding = loans.reduce((sum, l) => sum + owedNow(l), 0);
  const cash = computeCashPosition(todayCash ?? []);
 
  // Needs attention list order: paid first (quick to finish at the counter),
  // then overdue, then due soon. ".slice(0, 8)" keeps only the first 8.
  // D3: keep the FULL list too, so we know if some got cut off
  const attentionAll = [...readyToRelease, ...overdue, ...dueSoon];
 
 
  // D5: defaulted loans (grace period ended, not fully paid).
  // Only an Admin can forfeit, so only Admin asks the database for them.
  // "condition ? A : B" = if Admin, run the query (A); otherwise use an empty list (B).
  const { data: defaultedRows } =
    role === "admin"
      ? await supabase
          .from("loans") // the loans table
          .select("id, ticket_number, maturity_date, defaulted_at, principal_balance, interest_owed, interest_rate_percent, interest_accrued_through, status, customers(full_name)") // columns we need, plus the customer's name
          .eq("status", "defaulted") // only defaulted loans
          .is("archived_at", null) // skip archived ones
          .order("defaulted_at") // oldest default first (waiting longest = review first)
          .order("id") // Pagination: same date -> always the same order
      : { data: [] };
 
  // Tell TypeScript each row looks like a LoanRow plus a defaulted_at date.
  // "?? []" means: if the database gave back nothing, use an empty list.
  const waitingForfeit = (defaultedRows ?? []) as unknown as (LoanRow & { defaulted_at: string | null })[];
  // Pagination: only this page's loans are sent to the browser.
  // naSize = 3 if the forfeit list is also showing, otherwise 5 (see PAGE_SIZE_ALONE at the top)
  const naSize = waitingForfeit.length > 0 ? PAGE_SIZE : PAGE_SIZE_ALONE;
  // Math.ceil rounds up (111 loans / 3 = 37 -> 37 pages, 112 -> 38); "|| 1" = at least 1 page when the list is empty
  const naPages = Math.ceil(attentionAll.length / naSize) || 1;
  const naPage = pageNumber(na, naPages); // the page asked for in the address, kept in range
  // slice(6, 9) = loans 7 to 9 on page 3
  const attention = attentionAll.slice((naPage - 1) * naSize, naPage * naSize);
 
  // Pagination: same as Needs attention, but with its own page number ("wf")
  const wfPages = Math.ceil(waitingForfeit.length / PAGE_SIZE) || 1;
  const wfPage = pageNumber(wf, wfPages);
  const forfeitPage = waitingForfeit.slice((wfPage - 1) * PAGE_SIZE, wfPage * PAGE_SIZE);
  // Makes the address for a page of one list while keeping the other list's page.
  // e.g. going to Needs attention page 2 while Waiting for forfeit is on page 3 -> "/dashboard?na=2&wf=3"
  const pageHref = (list: "na" | "wf", p: number) => {
    const q = new URLSearchParams(); // builds the "?a=1&b=2" part
    const naNext = list === "na" ? p : naPage; // new page for this list, current page for the other
    const wfNext = list === "wf" ? p : wfPage;
    if (naNext > 1) q.set("na", String(naNext)); // page 1 is the default, so it's left out
    if (wfNext > 1) q.set("wf", String(wfNext));
    const str = q.toString();
    return str ? `/dashboard?${str}` : "/dashboard";
  };
 
  // Review #4 and #14: for paid loans, find WHEN they were fully paid (their latest payment),
  // so the table can say "Paid Oct 15, waiting 4d" instead of only the old due date.
  const paidIds = readyToRelease.map((l) => l.id); // ids of the paid loans
  const { data: paidPayments } = paidIds.length
    ? await supabase
        .from("loan_payments") // the payments table
        .select("loan_id, created_at") // which loan, and when
        .in("loan_id", paidIds) // only payments for the paid loans
        .is("archived_at", null) // skip archived payments
        .order("created_at", { ascending: false }) // newest first
    : { data: [] };
  // loan id -> date of its newest payment. Newest comes first, so we keep the first one we see.
  const paidOn = new Map<string, string>();
  for (const p of paidPayments ?? []) if (!paidOn.has(p.loan_id)) paidOn.set(p.loan_id, p.created_at);
 
  // Review 2 #6: details of flagged appraisals (oldest first, up to 3), so the alert names them
  const { data: flaggedRows } =
    (pendingFlags ?? 0) > 0
      ? await supabase
          .from("appraisal_items")
          .select("id, category, category_other, karat, weight_grams, created_at")
          .eq("is_counterfeit_risk", true)
          .eq("counterfeit_resolution", "pending")
          .is("archived_at", null)
          .order("created_at")
          .limit(1)
      : { data: [] };
  // Compact alert: the OLDEST flagged appraisal, and how many days it has waited.
  // The flag is set when the item is appraised, so created_at is the date it was flagged.
  const oldestFlag = (flaggedRows ?? [])[0];
  const flagDays = oldestFlag ? Math.max(0, -daysUntilDue(manilaToday(new Date(oldestFlag.created_at)), today)) : 0;
 
  // Review 2 #4: a paid item waiting longer than this many days gets an amber warning.
  // TODO: confirm the number of days with CTM Pawnshop (30 is a placeholder).
  const UNCLAIMED_WARN_DAYS = 30;
  // how many days a paid loan's item has waited since its last payment
  const waitingDays = (loanId: string) => {
    const paidAt = paidOn.get(loanId); // date of the last payment
    return paidAt ? -daysUntilDue(manilaToday(new Date(paidAt)), today) : 0; // days since then
  };
 
  // Review 2 #13: loans due within 3 days (the Reminders list), shown on the Send reminders shortcut
  const remindersDue = loans.filter((l) => !isPaid(l) && isDueForReminder(l.maturity_date, today)).length;
 
 
  // Redesign: today's date under the title, in Philippine time, e.g. "Monday, October 19, 2026"
  const todayLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(now);
 
  // Review #2: split what is owed into principal and interest (same numbers as before, just separated)
  const principalTotal = loans.reduce((sum, l) => sum + Number(l.principal_balance), 0);
  const interestTotal = outstanding - principalTotal;
 
  // Redesign: the 4 summary cards as one list, so the page draws them with one loop.
  // icon = small sidebar icon next to the label; tone = colour of the number.
  type IconName = Parameters<typeof Icon>[0]["name"];
  type Kpi = { label: string; value: string; hint: string; detail?: string; href: string; icon: IconName; tone: "default" | "danger" | "warning" };
  const kpis: Kpi[] = [
    // card 1: open loans and the total still owed
    { label: "Open loans", value: String(loans.length), hint: `${formatPeso(outstanding)} outstanding`, detail: `${formatPeso(principalTotal)} principal, ${formatPeso(interestTotal)} interest`, href: "/dashboard/loans?status=open", icon: "ticket", tone: "default" },
    // card 2: overdue loans (Admin goes to the Overdue report, others to the Loans list)
    { label: "Overdue", value: String(overdue.length), hint: "Past due date, not yet defaulted", detail: waitingForfeit.length ? `+${waitingForfeit.length} past grace period (forfeit pending)` : undefined, href: role === "admin" ? "/dashboard/reports/overdue" : "/dashboard/loans?status=overdue", icon: "alert", tone: overdue.length ? "danger" : "default" },
    // card 3: loans due today up to 7 days from now (Cashier goes to Reminders)
    { label: "Due in 7 days", value: String(dueSoon.length), hint: "Due today up to 7 days from now", href: hasRole(role, ["cashier"]) ? "/dashboard/compliance/reminders" : "/dashboard/loans?status=open", icon: "bell", tone: dueSoon.length ? "warning" : "default" },
    // card 4: staff who handle cash see today's cash; everyone else sees the customer count
    canSeeCash
      ? { label: "Net cash today", value: formatPeso(cash.net), hint: `${formatPeso(cash.totalIn)} in, ${formatPeso(cash.totalOut)} out`, href: "/dashboard/finance", icon: "cash", tone: "default" }
      : { label: "Customers on file", value: String(customerCount ?? 0), hint: "Registered customers", href: "/dashboard/customers", icon: "users", tone: "default" },
  ];
  // picks the text colour for a number: red, amber, or the normal navy
  const toneClass = (tone: Kpi["tone"]) => (tone === "danger" ? "text-red-700" : tone === "warning" ? "text-amber-700" : "text-navy-900");
 
  // Redesign: quick links to common jobs. Each one only shows for roles that can do it
  // (hasRole also lets Admin through). These are the same pages as the sidebar, no new features.
  // Review #10: icons, and the two most-used counter jobs (main = true) shown stronger and first.
  // group = which heading it sits under (same groups as the sidebar)
  type Shortcut = { show: boolean; href: string; label: string; hint: string; icon: IconName; main?: boolean; group: "Counter" | "Vault & cash" };
  const allShortcuts: Shortcut[] = [
    { show: hasRole(role, ["cashier"]), href: "/dashboard/loans/new", label: "New loan", hint: "Customer + appraised item", icon: "plus", main: true, group: "Counter" },
    { show: hasRole(role, ["cashier"]), href: "/dashboard/loans?status=open", label: "Payment, renewal or redemption", hint: "Open the loan, pick the action", icon: "ticket", main: true, group: "Counter" },
    { show: hasRole(role, ["appraiser", "cashier"]), href: "/dashboard/appraisals?new=1", label: "New appraisal", hint: "Weigh and value an item", icon: "scale", group: "Counter" },
    { show: hasRole(role, ["operator"]), href: "/dashboard/customers?new=1", label: "Register customer", hint: "Name, ID and contact", icon: "users", group: "Counter" },
    { show: canSeeCash, href: "/dashboard/finance", label: "Record cash entry", hint: "Expenses and other revenue", icon: "cash", group: "Vault & cash" },
    { show: hasRole(role, ["cashier"]) && role !== "admin", href: "/dashboard/compliance/reminders", label: "Send reminders", hint: remindersDue ? `${remindersDue} loan${remindersDue === 1 ? "" : "s"} due within 3 days` : "No loans due within 3 days", icon: "bell", group: "Counter" },
    { show: hasRole(role, ["operator"]), href: "/dashboard/inventory/audit", label: "Physical audit", hint: "Check every vault item", icon: "clipboard", group: "Vault & cash" },
  ];
  const shortcuts = allShortcuts.filter((s) => s.show); // keep only the ones this role can use
  // split into the two groups; a group with nothing in it is skipped
  const shortcutGroups = (["Counter", "Vault & cash"] as const)
    .map((g) => ({ title: g, items: shortcuts.filter((s) => s.group === g) }))
    .filter((g) => g.items.length > 0);
 
  // How many days until a loan is due (used for the "in 3d" note on due-soon rows)
  const dueIn = (l: LoanRow) => daysUntilDue(l.maturity_date, today);
 
  const primary = hasRole(role, ["cashier"])
    ? { href: "/dashboard/loans/new", label: "New loan" }
    : hasRole(role, ["appraiser"])
      ? { href: "/dashboard/appraisals?new=1", label: "New appraisal" }
      : hasRole(role, ["operator"])
        ? { href: "/dashboard/customers?new=1", label: "Register customer" }
        : null;
 
  return (
    // Viewport fit: space-y-4 = 16px between the big blocks (was 24px), saves height on laptop screens
    <div className="space-y-4">
      <PageHeader
        // Viewport fit: today's date sits on the same line as the title (saves a line of height)
        title={
          <>
            Dashboard
            {/* font-sans = normal font, not the title font; hidden on phones where space is short */}
            <span className="ml-3 hidden font-sans text-sm font-normal tracking-normal text-slate-500 sm:inline">{todayLabel}</span>
          </>
        }
        actions={
          // <> </> groups the search box and the button together
          <>
            {/* Search with live preview: type 2+ letters to see matching customers and loans.
                The Search button (or Enter) opens all matching loans on the Loans page. */}
            <QuickSearch />
            {/* the main button for this role (if it has one) */}
            {primary && (
              <ButtonLink href={primary.href} variant="primary">
                {/* "+" icon so the main action is easy to spot */}
                <Icon name="plus" className="h-4 w-4" />
                {primary.label}
              </ButtonLink>
            )}
          </>
        }
      />
 
      {/* D2: only shows when the address has ?denied=1 */}
      {denied === "1" && (
        <Alert tone="warning" title="You don't have access to that page.">
          It is not available to your role ({ROLE_LABELS[role]}). Ask an Admin if you need it.
        </Alert>
      )}
 
      {/* Viewport fit: the two warnings sit side by side on wide screens (counterfeit gets 3/5 of the width
          because its text is longer), stacked on smaller ones.
          They stay separate boxes with their own colour and their own button. Only drawn if at least one shows. */}
      {((pendingFlags ?? 0) > 0 || (openSuspicious ?? 0) > 0) && (
      <div className={cx("grid gap-3", (pendingFlags ?? 0) > 0 && (openSuspicious ?? 0) > 0 && "xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]")}>
      {/* Counterfeit alert (compact): ONE slim row on computers, wraps to 2 rows on phones.
          Only shows when at least 1 appraisal is waiting for counterfeit review. */}
      {(pendingFlags ?? 0) > 0 && (
        // role="alert" = screen readers announce it; py-2 + small button keep it about 48px tall
        <div role="alert" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-slate-800">
          {/* left side: icon + message + item details (min-w-0 lets long text wrap instead of overflowing) */}
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            {/* small warning icon */}
            <Icon name="alert" className="h-4 w-4 shrink-0 text-red-700" />
            {/* short message. "Possible counterfeit" = suspected only, not confirmed */}
            <span className="font-medium text-red-900">
              Possible counterfeit: {pendingFlags} appraisal{pendingFlags === 1 ? "" : "s"}{" "}
              {/* Admin: "needs review" (1) / "need review" (2+). Others: waiting for an Admin. */}
              {role === "admin" ? (pendingFlags === 1 ? "needs review" : "need review") : "waiting for Admin review"}
            </span>
            {/* item details in grey, on the same row (they wrap under the message on small screens) */}
            {oldestFlag && (
              <span className="text-slate-600">
                {/* one flagged item: what it is + when it was flagged */}
                {pendingFlags === 1 ? (
                  <>
                    · {categoryLabel(oldestFlag.category, oldestFlag.category_other)}, {oldestFlag.karat}K, {oldestFlag.weight_grams} g · Flagged{" "}
                    {formatDate(oldestFlag.created_at)} ·{" "}
                  </>
                ) : (
                  // several flagged items: only say how long the oldest has waited
                  <>· Oldest </>
                )}
                {/* days waiting, worked out from the real date; bold after 7 days */}
                <span className={cx("whitespace-nowrap", flagDays > 7 && "font-semibold text-red-800")}>{flagDays}d pending</span>
              </span>
            )}
          {/* end of left side */}
          </span>
          {/* small button. 1 flagged item: opens that appraisal. Several: opens the list of flagged items.
              It only opens the page; clearing or confirming is still done there, by an Admin. */}
          <ButtonLink href={pendingFlags === 1 && oldestFlag ? `/dashboard/appraisals/${oldestFlag.id}` : "/dashboard/appraisals?risk=pending"} size="sm">
            {/* D6: only an Admin can clear or confirm a flag, so other roles "view" */}
            {pendingFlags === 1 ? (role === "admin" ? "Review" : "View") : "View all"}
          </ButtonLink>
        </div>
      )}
      {/* Suspicious-activity alert: Admin only, only when flags are open */}
      {(openSuspicious ?? 0) > 0 && (
        // Viewport fit: px-3 py-2 = same slim size as the counterfeit alert
        <div role="alert" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {/* left side: icon + message */}
          <span className="flex items-center gap-2">
            {/* Redesign: shield icon, same as Suspicious activity in the sidebar */}
            <Icon name="shield" className="h-4 w-4 shrink-0 text-amber-700" />
            <span>
              <strong>{openSuspicious}</strong> suspicious-activity flag{openSuspicious === 1 ? "" : "s"} open.
            </span>
          {/* end of left side */}
          </span>
          <ButtonLink href="/dashboard/compliance" size="sm">
            Review flags
          </ButtonLink>
        </div>
      )}
      {/* end of the warnings row */}
      </div>
      )}
 
      {/* Redesign: 4 summary cards in one row on wide screens (lg = 1024px and up),
          2 per row on smaller screens. Each card is a link to the matching list. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* one card per number */}
        {kpis.map((k) => (
          // the whole card is a link; hover makes the border darker so you know it's clickable
          <Link key={k.label} href={k.href} className="block rounded-md border border-slate-200 bg-white px-4 py-2.5 transition-colors hover:border-navy-300">
            {/* top line: small icon + label */}
            <span className="flex items-center gap-2 text-sm font-medium text-slate-600">
              {/* the icon (same set as the sidebar, no coloured circle) */}
              <Icon name={k.icon} className="h-4 w-4 shrink-0 text-slate-500" />
              {/* the label, e.g. Open loans */}
              {k.label}
            {/* end of top line */}
            </span>
            {/* the big number, coloured by its tone (red = overdue, amber = due soon) */}
            {/* Viewport fit: text-2xl and mt-1 (was text-3xl, mt-2) so the cards are about 110px tall */}
            <span className={cx("mt-1 block text-2xl font-semibold tabular-nums", toneClass(k.tone))}>{k.value}</span>
            {/* the explanation line under the number */}
            <span className="mt-0.5 block text-sm text-slate-500">{k.hint}</span>
            {/* second line: principal vs interest on Open loans; forfeit-pending count on Overdue (Admin) */}
            {/* Viewport fit: text-xs for the extra detail line, so it rarely wraps */}
            {k.detail && <span className="mt-0.5 block text-xs text-slate-500">{k.detail}</span>}
          {/* end of the card */}
          </Link>
        ))}
      {/* end of the cards row */}
      </div>
 
      {/* Redesign: two columns on wide screens. Left = the loan lists to work on, right = quick actions.
          On smaller screens the quick actions go under the lists.
          items-start = each item is only as tall as its content */}
      {/* Viewport fit: quick actions get a fixed 17rem (19rem from 1536px); the lists get the rest,
          so their columns don't squeeze and wrap. minmax(0,1fr) stops a wide table from pushing the page sideways. */}
      {/* Alignment: ONE shared grid for both columns, so the headings and the cards line up by themselves.
            Row 1 = the two headings (Needs attention | Quick actions)
            Row 2 = the two cards (Needs attention table | Quick actions card, which also spans row 3)
            Row 3 = Waiting for forfeit (left only)
          A row is as tall as its tallest item, so if the left description wraps (zoom, small screen),
          both cards still start at the same height. Below 1280px wide (xl; small laptops, 125%+ zoom) it's one column
          in reading order, so the table keeps enough width for its buttons. */}
      <div className="grid gap-x-4 xl:grid-cols-[minmax(0,1fr)_17rem] xl:items-start 2xl:grid-cols-[minmax(0,1fr)_19rem]">
          {/* className="contents" = the section's heading and card become items of the grid above */}
          <section className="contents">
            {/* row 1, left: the heading. The short explanation sits to the right of the title */}
            <div className="min-w-0 xl:col-start-1 xl:row-start-1">
              <SectionTitle actions={<span className="text-sm text-slate-500">Ready to release, overdue, or due within 7 days</span>}>
                {/* the count in brackets = how many loans are in the list */}
                Needs attention <span className="ml-1 font-normal text-slate-500">({attentionAll.length})</span>
              </SectionTitle>
            {/* end of the heading */}
            </div>
            {/* row 2, left: the table card. min-w-0 lets it shrink on small screens */}
            <Card padded={false} className="min-w-0 xl:col-start-1 xl:row-start-2">
              {attention.length === 0 ? (
                <EmptyState title="Nothing overdue or due in the next 7 days." />
              ) : (
                <>
                  {/* D4: PHONE ONLY (sm:hidden). One compact block per loan instead of a wide table. */}
                  <ul className="divide-y divide-slate-100 sm:hidden">
                    {attention.map((loan) => {
                      const paid = isPaid(loan);
                      const late = paid ? 0 : -dueIn(loan);
                      return (
                        <li key={loan.id}>
                          {/* The whole block is one big link: easy to tap with a thumb */}
                          <Link href={`/dashboard/loans/${loan.id}`} className="block px-4 py-3 hover:bg-slate-50">
                            {/* Line 1: customer on the left, amount owed on the right */}
                            <div className="flex items-start justify-between gap-3">
                              <span className="font-medium text-slate-900">{loan.customers?.full_name ?? ""}</span>
                              <span className="whitespace-nowrap font-medium tabular-nums text-slate-900">{formatPeso(owedNow(loan))}</span>
                            </div>
                            {/* Line 2: status badge, due date, ticket number */}
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                              {/* Redesign: one clear status per row (see the table below) */}
                              {paid ? (
                                <StatusBadge status="redeemed" label="Paid, ready to release" />
                              ) : late > 0 ? (
                                <StatusBadge status="defaulted" label="Overdue" />
                              ) : (
                                <StatusBadge status="pending" label="Due soon" />
                              )}
                              {/* Review #4: paid loans show when they were paid; others show the due date */}
                              <span>{paid && paidOn.get(loan.id) ? `Paid ${formatDate(paidOn.get(loan.id))}, ${waitingDays(loan.id)}d waiting` : `Due ${formatDate(loan.maturity_date)}`}</span>
                              <span className="font-mono">{loan.ticket_number}</span>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
 
                  {/* COMPUTER ONLY (hidden sm:block): the table */}
                  <div className="hidden sm:block">
                    {/* Pagination: max-h-60 = never taller than 240px (room for 3 rows); max-h-80 = 320px when it shows 5 rows.
                        Extra rows only scroll inside it
                        when text wraps a lot (big zoom).
                        key={naPage} = a fresh box on each page, so its scroll starts back at the top */}
                    <Table minWidth="640px" className={naSize > PAGE_SIZE ? "max-h-80 overflow-y-auto" : "max-h-60 overflow-y-auto"} key={naPage}>
                      {/* sticky = column headings stay visible while the rows scroll */}
                      <THead sticky>
                        {/* Viewport fit: own Ticket column only on wide screens (2xl = 1536px and up); on smaller ones it shows under the name */}
                        <TH className="hidden 2xl:table-cell">Ticket</TH>
                        <TH>Customer</TH>
                        {/* Review #14: "Date" because paid loans show the payment date, others the due date */}
                        <TH>Date</TH>
                        {/* Viewport fit: whitespace-nowrap keeps "Owed now" on one line, so the heading row stays short */}
                        <TH align="right" className="whitespace-nowrap">Owed now</TH>
                        <TH>Status</TH>
                        <TH>
                          <span className="sr-only">Actions</span>
                        </TH>
                      </THead>
                      <TBody>
                        {attention.map((loan) => {
                          // paid = nothing left to pay; late = days past the due date (0 if not late)
                          const paid = isPaid(loan);
                          const late = paid ? 0 : -dueIn(loan);
                          return (
                            // Redesign: no red row tint; the red "Overdue" badge is enough
                            <TR key={loan.id}>
                              <TD mono className="hidden whitespace-nowrap 2xl:table-cell">
                                {/* Viewport fit: long tickets are cut with "..." at 11rem; hover shows the full number */}
                                <span className="block max-w-[11rem] truncate" title={loan.ticket_number}>{loan.ticket_number}</span>
                              </TD>
                              <TD>
                                {/* the customer's name */}
                                {loan.customers?.full_name ?? ""}
                                {/* Viewport fit: ticket under the name on screens narrower than 1536px (the Ticket column is hidden there);
                                    one line, ends with "..." if too long, full number on hover */}
                                <span className="block max-w-[9rem] truncate font-mono text-xs text-slate-500 2xl:hidden" title={loan.ticket_number}>{loan.ticket_number}</span>
                              </TD>
                              {/* Viewport fit: the date stays on one line */}
                              <TD className="whitespace-nowrap">
                                {paid && paidOn.get(loan.id) ? (
                                  // Review #4: paid loan = payment date + how long the item has waited
                                  <>
                                    Paid {formatDate(paidOn.get(loan.id))}
                                    {/* Review 2 #4: amber and bold when the item has waited too long */}
                                    <span className={cx("ml-1 text-xs", waitingDays(loan.id) > UNCLAIMED_WARN_DAYS ? "font-semibold text-amber-700" : "text-slate-500")}>
                                      ({waitingDays(loan.id)}d waiting{waitingDays(loan.id) > UNCLAIMED_WARN_DAYS ? ", unclaimed" : ""})
                                    </span>
                                  </>
                                ) : (
                                  // everyone else: the due date
                                  <>Due {formatDate(loan.maturity_date)}</>
                                )}
                                {/* small note: how late, or how many days left */}
                                {late > 0 && <span className="ml-1 text-xs font-semibold text-red-700">({late}d late)</span>}
                                {!paid && late <= 0 && <span className="ml-1 text-xs text-slate-500">({dueIn(loan) === 0 ? "today" : `in ${dueIn(loan)}d`})</span>}
                              </TD>
                              <TD align="right">{formatPeso(owedNow(loan))}</TD>
                              <TD>
                                {/* Redesign: one clear status per row.
                                    Paid = green, Overdue = red, Due soon = amber. Words, not just colour. */}
                                {paid ? (
                                  <StatusBadge status="redeemed" label="Paid, ready to release" />
                                ) : late > 0 ? (
                                  <StatusBadge status="defaulted" label="Overdue" />
                                ) : (
                                  <StatusBadge status="pending" label="Due soon" />
                                )}
                              </TD>
                              <ActionsCell>
                                {/* Review #4: paid loans say what to do next. Both open the loan page, where the
                                    Cashier checks the ticket (or the customer's ID for a lost ticket) and confirms
                                    the redemption. Nothing is released automatically, and a redeemed loan can't be redeemed again. */}
                                {/* Roles: only Cashier and Admin can release an item, so Operator and Appraiser just see "View loan" */}
                                <ViewButton href={`/dashboard/loans/${loan.id}`}>{paid && canRelease ? "Review release" : "View loan"}</ViewButton>
                              </ActionsCell>
                            </TR>
                          );
                        })}
                      </TBody>
                    </Table>
                  {/* closes the computer-only div */}
                  </div>
                {/* closes the <> fragment */}
                </>
              )}
 
              {/* Pagination: Previous / Page X of Y / Next + See all (replaces the old "Showing 8 of N" bar) */}
              {attentionAll.length > 0 && (
                <ListPager
                  label="Needs attention"
                  page={naPage}
                  totalPages={naPages}
                  total={attentionAll.length}
                  pageSize={naSize}
                  hrefFor={(p) => pageHref("na", p)}
                  seeAllHref="/dashboard/loans?status=open&sort=due&dir=asc"
                  seeAllLabel="See all open loans"
                />
              )}
            </Card>
          </section>
 
          {/* D5: Admin-only list of defaulted loans. Hidden when there are none.
              Alignment: row 3, left column; mt-3 = 12px under the Needs attention card */}
          {waitingForfeit.length > 0 && (
            <section className="mt-3 min-w-0 xl:col-start-1 xl:row-start-3">
              <SectionTitle actions={<span className="text-sm text-slate-500">Grace period ended without full payment</span>}>
                {/* the count in brackets */}
                Waiting for forfeit <span className="ml-1 font-normal text-slate-500">({waitingForfeit.length})</span>
              </SectionTitle>
              <Card padded={false}>
                {/* PHONE ONLY (sm:hidden): one tappable block per loan, same as Needs attention */}
                <ul className="divide-y divide-slate-100 sm:hidden">
                  {forfeitPage.map((loan) => (
                    <li key={loan.id}>
                      {/* the whole block opens the loan, where the Admin reviews the forfeit */}
                      <Link href={`/dashboard/loans/${loan.id}`} className="block px-4 py-3 hover:bg-slate-50">
                        {/* Line 1: customer on the left, amount owed on the right */}
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-medium text-slate-900">{loan.customers?.full_name ?? ""}</span>
                          <span className="whitespace-nowrap font-medium tabular-nums text-slate-900">{formatPeso(owedNow(loan))}</span>
                        </div>
                        {/* Line 2: status, grace end date, ticket number */}
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                          <StatusBadge status="defaulted" label="Forfeit pending" />
                          <span>Grace ended {formatDate(loan.defaulted_at)}</span>
                          <span className="font-mono">{loan.ticket_number}</span>
                        </div>
                      {/* end of the tappable block */}
                      </Link>
                    </li>
                  ))}
                {/* end of the phone list */}
                </ul>
 
                {/* COMPUTER ONLY (hidden sm:block). Pagination: same bounded, scrollable box as Needs attention, with its own page (wfPage) */}
                <div className="hidden sm:block">
                <Table minWidth="640px" className="max-h-60 overflow-y-auto" key={wfPage}>
                  <THead sticky>
                    {/* Viewport fit: own Ticket column only on wide screens (2xl = 1536px and up); on smaller ones it shows under the name */}
                        <TH className="hidden 2xl:table-cell">Ticket</TH>
                    <TH>Customer</TH>
                    {/* Review 2 #5: the date it became eligible for forfeit review */}
                    <TH className="whitespace-nowrap">Grace ended</TH>
                    {/* Viewport fit: whitespace-nowrap keeps "Owed now" on one line, so the heading row stays short */}
                        <TH align="right" className="whitespace-nowrap">Owed now</TH>
                    <TH>Status</TH>
                    <TH>
                      {/* sr-only = hidden on screen, read out by screen readers */}
                      <span className="sr-only">Actions</span>
                    </TH>
                  </THead>
                  <TBody>
                    {/* .map() makes one table row for each defaulted loan */}
                    {forfeitPage.map((loan) => (
                      <TR key={loan.id}>
                        <TD mono className="hidden whitespace-nowrap 2xl:table-cell">
                                {/* Viewport fit: long tickets are cut with "..." at 11rem; hover shows the full number */}
                                <span className="block max-w-[11rem] truncate" title={loan.ticket_number}>{loan.ticket_number}</span>
                              </TD>
                        <TD>
                                {/* the customer's name */}
                                {loan.customers?.full_name ?? ""}
                                {/* Viewport fit: ticket under the name on screens narrower than 1536px (the Ticket column is hidden there);
                                    one line, ends with "..." if too long, full number on hover */}
                                <span className="block max-w-[9rem] truncate font-mono text-xs text-slate-500 2xl:hidden" title={loan.ticket_number}>{loan.ticket_number}</span>
                              </TD>
                        <TD className="whitespace-nowrap">{formatDate(loan.defaulted_at)}</TD>
                        <TD align="right">{formatPeso(owedNow(loan))}</TD>
                        {/* Redesign: status column, same place as in the table above */}
                        <TD>
                          <StatusBadge status="defaulted" label="Forfeit pending" />
                        </TD>
                        <ActionsCell>
                          {/* Review 2 #5: opens the loan, where the Admin reviews it and confirms the forfeit
                              (there is a confirm step, and it is saved in the audit trail). Never automatic. */}
                          <ViewButton href={`/dashboard/loans/${loan.id}`}>Review forfeit</ViewButton>
                        </ActionsCell>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                {/* closes the computer-only div */}
                </div>
                {/* Pagination: its own Previous / Next, so it never changes the Needs attention page */}
                <ListPager
                  label="Waiting for forfeit"
                  page={wfPage}
                  totalPages={wfPages}
                  total={waitingForfeit.length}
                  pageSize={PAGE_SIZE}
                  hrefFor={(p) => pageHref("wf", p)}
                  seeAllHref="/dashboard/loans?status=defaulted"
                  seeAllLabel="See all defaulted loans"
                />
              </Card>
            </section>
          )}
 
        {/* quick actions. Hidden if this role has none. */}
        {shortcuts.length > 0 && (
          // aria-label tells screen readers what this box is
          // className="contents" = its heading and card become items of the shared grid
          <aside aria-label="Quick actions" className="contents">
            {/* row 1, right: same SectionTitle as "Needs attention" (same size and gap).
                mt-4 only on phones, where it sits under the lists. COUNTER / VAULT & CASH stay inside as group labels. */}
            <div className="mt-4 min-w-0 xl:col-start-2 xl:row-start-1 xl:mt-0">
              <SectionTitle>Quick actions</SectionTitle>
            {/* end of the heading */}
            </div>
            {/* row 2 (and 3), right: the card starts on the same line as the Needs attention table.
                row-span-2 so a tall card doesn't push Waiting for forfeit down */}
            <Card padded={false} className="min-w-0 xl:col-start-2 xl:row-span-2 xl:row-start-2">
              {/* Review 2 #7: one block per group (Counter first, then Vault & cash) */}
              {shortcutGroups.map((g, gi) => (
                // border-t between groups, but not above the first one
                <div key={g.title} className={cx(gi > 0 && "border-t border-slate-200")}>
                  {/* small group heading */}
                  <p className="px-4 pt-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</p>
                  {/* the list; divide-y draws a thin line between rows */}
                  <ul className="divide-y divide-slate-100">
                    {g.items.map((s) => (
                      <li key={s.href + s.label}>
                        {/* the whole row is a link: label + hint on the left, arrow on the right.
                            Viewport fit: py-2 (was py-4) so all actions plus the "Quick actions" heading fit beside the lists */}
                        <Link href={s.href} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-slate-50">
                          {/* left: icon + what it does */}
                          <span className="flex min-w-0 items-start gap-3">
                            {/* Review #10: icon; navy for the 2 main jobs, grey for the rest */}
                            <Icon name={s.icon} className={cx("mt-0.5 h-4 w-4 shrink-0", s.main ? "text-navy-700" : "text-slate-500")} />
                            <span className="min-w-0">
                              {/* label: bolder and navy for the 2 main jobs */}
                              <span className={cx("block text-sm", s.main ? "font-semibold text-navy-900" : "font-medium text-slate-900")}>{s.label}</span>
                              {/* Viewport fit: the hint stays on one line; if it's too long it ends with "...", full text on hover */}
                              <span className="block truncate text-sm text-slate-500" title={s.hint}>{s.hint}</span>
                            </span>
                          </span>
                          {/* right: arrow, so it looks clickable */}
                          <Icon name="chevron-right" className="h-4 w-4 shrink-0 text-slate-400" />
                        {/* end of the link */}
                        </Link>
                      </li>
                    ))}
                  {/* end of this group's list */}
                  </ul>
                </div>
              ))}
            </Card>
          {/* end of quick actions */}
          </aside>
        )}
      {/* end of the shared grid */}
      </div>
    </div>
  );
}