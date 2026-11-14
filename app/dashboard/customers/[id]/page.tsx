import { customerNo } from "@/lib/ref-numbers"; // #18: the short customer number (C-0012)
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { formatDate, formatPeso, manilaToday } from "@/lib/format";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { computeCustomerScore, weightsFromRows } from "@/lib/customers/score";
// C1: interest that piled up after the due date (same math as the Dashboard and loan page)
// C8: "how many days until this date" (negative = in the past), same helper as the Dashboard
import { daysUntilDue } from "@/lib/compliance/reminders";
import { ScoreBadge } from "@/components/score-badge";
import { ArchiveForm } from "@/components/archive-controls";
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  DetailGrid,
  EmptyState,
  PageHeader,
  SectionTitle,
  StatusBadge,
  ViewButton,
  buttonClasses, // F1: button look for the Previous / Next links
} from "@/components/ui";
import { AdminIdentityForm } from "../customer-form";
// PR1: "Customer details" card with the Edit contact details button
import { ContactDetails } from "./contact-details";
// PR3: the small arrow on the Admin action rows
import { Icon } from "@/components/icons";
// PR5: link to the Archive page (where archived customers are restored)
import Link from "next/link";
// PR7: (i) button that explains the score, and its text (same as on the Customers list)
import { InfoTip } from "../info-tip";
import { SCORE_HELP } from "../help-text";
import { BlacklistForm } from "./blacklist-form";
// P3: masked ID + eye button, and who may reveal a full ID
import { IdReveal } from "../id-reveal";
import { ID_REVEAL_ROLES, idEnding, maskId } from "@/lib/customers/id-privacy";
// PR13: "nothing left to pay", to show "Paid, awaiting release" on an item
import { isFullyPaid, owedNow } from "@/lib/loans/status"; // LD: owedNow includes liquidated damages

type LoanHistoryRow = {
  id: string;
  ticket_number: string;
  principal_amount: number;
  principal_balance: number;
  interest_owed: number;
  // C1: these two are needed to work out the late interest
  interest_rate_percent: number;
  interest_accrued_through: string | null;
  // LD (0073): liquidated damages, so owed amounts include them
  grace_period_days: number;
  liquidated_damages_percent: number;
  damages_owed: number;
  damages_accrued_through: string | null;
  status: string;
  loan_date: string;
  maturity_date: string;
  extension_count: number;
  late_payment_count: number;
  defaulted_at: string | null;
  reinstated_at: string | null;
  redeemed_at: string | null;
  archived_at: string | null;
  appraisal_item_id: string | null; // PR13: which item this loan is for (one item per loan)
  loan_payments: { id: string; amount: number; receipt_number: string; created_at: string }[];
  // C4: extension_type tells a cash renewal apart from a capitalize (no cash)
  loan_extensions: { id: string; new_maturity_date: string; additional_interest_amount: number; capitalized_amount: number; extension_type: string; created_at: string }[];
};

// C2 + C3 + C8: one status word per loan, the SAME words the Dashboard uses.
// "badge" picks the colour of the existing StatusBadge, "label" is the word shown.
function loanLabel(loan: LoanHistoryRow, owed: number, today: string): { badge: string; label: string } {
  const open = loan.status === "active" || loan.status === "extended" || loan.status === "reinstated"; // still running
  if (open && owed < 0.01) return { badge: "redeemed", label: "Paid, ready to release" }; // C2: nothing left to pay (green)
  if (open) {
    const days = daysUntilDue(loan.maturity_date, today); // days until due (negative = late)
    if (days < 0) return { badge: "pending", label: "Overdue" }; // past the due date (L26: amber, red is only for Defaulted)
    if (days <= 7) return { badge: "pending", label: "Due soon" }; // C8: due within 7 days (amber)
    if (loan.status === "extended") return { badge: "extended", label: "Renewed" }; // C3: "Renewed", not "Extended"
    if (loan.status === "reinstated") return { badge: "reinstated", label: "Reinstated" };
    return { badge: "active", label: "Active" };
  }
  if (loan.status === "defaulted") return { badge: "defaulted", label: "Defaulted" }; // grace period ended
  if (loan.status === "redeemed") return { badge: "redeemed", label: "Redeemed" };
  return { badge: loan.status, label: loan.status === "forfeited" ? "Forfeited" : loan.status };
}

// F8: the browser tab shows the customer's name ("Pedro Reyes · CTM PawnTrack"), never the ID number.
// Same login check as the page; a wrong link just says "Customer".
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["operator", "cashier", "appraiser", "admin"]); // only signed-in staff
  const { id } = await params; // the customer id from the address
  const supabase = await createClient(); // database connection with the user's permissions
  const { data } = await supabase.from("customers").select("full_name").eq("id", id).maybeSingle(); // only the name
  return { title: data?.full_name ?? "Customer" }; // the layout adds " · CTM PawnTrack"
}

// F1: how many loan cards and items show per page on the profile
const LOAN_PAGE = 4; // PR13: 4 per page (was 5), so Loans and Items stay a similar height
const ITEM_PAGE = 4;
// F1: turns "?lp=3" into a safe page number between 1 and the last page
function pageNo(value: string | undefined, pages: number) {
  const n = Number.parseInt(value ?? "1", 10); // the number in the address
  return Math.min(Math.max(Number.isFinite(n) ? n : 1, 1), Math.max(pages, 1)); // at least 1, at most the last page
}

// F1 + PR13: the same pager under both lists: "Showing 1–4 of 8", then Previous / Page X of Y / Next.
// "param" is lp (loans) or ip (items), so each list keeps its own page and the other list's page stays as it is.
// Buttons that can't be used are shown greyed out (not removed), so the row doesn't jump around.
function HistoryPager({ base, param, page, pages, total, size, other }: { base: string; param: string; page: number; pages: number; total: number; size: number; other: Record<string, number> }) {
  if (total <= size) return null; // everything fits on one page: no pager needed
  const href = (p: number) => {
    const q = new URLSearchParams(); // the "?..." part of the address
    for (const [k, v] of Object.entries(other)) if (v > 1) q.set(k, String(v)); // keep the other list's page
    if (p > 1) q.set(param, String(p)); // this list's page (page 1 = no number)
    const qs = q.toString();
    return qs ? `${base}?${qs}` : base; // the address for that page
  };
  const btn = buttonClasses("secondary", "sm"); // small white buttons, same as elsewhere
  const off = `${btn} pointer-events-none opacity-60`; // CT1: was opacity-40, too faint to read // greyed-out look for a button that can't be used
  const from = (page - 1) * size + 1; // first record on this page
  const to = Math.min(total, page * size); // last record on this page
  return (
    // the pager row: count on the left, buttons and page number on the right
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
      <span>
        Showing {from}–{to} of {total}
      </span>
      <span className="flex items-center gap-2">
        {page > 1 ? <Link href={href(page - 1)} scroll={false} className={btn}>Previous</Link> : <span className={off} aria-disabled="true">Previous</span>}
        <span className="whitespace-nowrap">Page {page} of {pages}</span>
        {page < pages ? <Link href={href(page + 1)} scroll={false} className={btn}>Next</Link> : <span className={off} aria-disabled="true">Next</span>}
      </span>
    {/* end of the pager */}
    </nav>
  );
}

// PR13: where the item is now, from the vault record (inventory_items.status) and its loan.
// Uses only statuses the system already has; "Paid, awaiting release" = loan fully paid but item still in the vault.
function custody(invStatus: string | undefined, loan: LoanHistoryRow | undefined, appraisalStatus: string, today: string): { badge: string; label: string } {
  if (invStatus === "pawned" || invStatus === "extended") {
    if (loan && isFullyPaid(loan, today)) return { badge: "pending", label: "Paid, awaiting release" }; // amber: hand it over at the counter
    return { badge: "active", label: "In vault" }; // blue: held as collateral
  }
  if (invStatus === "redeemed") return { badge: "redeemed", label: "Released" }; // green: given back to the customer
  if (invStatus === "forfeited") return { badge: "forfeited", label: "Forfeited" }; // the shop kept it
  if (invStatus === "queued_for_auction") return { badge: "forfeited", label: "Queued for auction" };
  if (invStatus === "sold") return { badge: "neutral", label: "Sold at auction" }; // #43: the shop sold it
  if (appraisalStatus === "available") return { badge: "neutral", label: "Not pawned" }; // appraised only, no loan
  return { badge: "neutral", label: "No vault record" }; // shouldn't happen; shown instead of guessing
}

// PR13: lets a long email break after "@" and before dots, instead of in the middle of a word
function breakableEmail(email: string) {
  return email.split(/(?=[.@])|(?<=@)/).map((part, i) => (
    <span key={i}>
      {i > 0 && <wbr />}
      {part}
    </span>
  ));
}

// CP1 (Nov 14): what Owed now means on this page (the same words as the Loans list and the Dashboard)
const OWED_NOW_HELP =
  "The total amount the customer currently owes: unpaid principal, interest, and any liquidated damages after the grace period. The actions available depend on the loan's status.";

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lp?: string; ip?: string }>; // F1: lp = loans page, ip = items page
}) {
  const user = await requireRole(["operator", "cashier", "appraiser", "admin"]);
  const role = user.profile.role;
  const { id } = await params;

  const supabase = await createClient();
  const { data: customer } = await createAdminClient().from("customers").select("*").eq("id", id).maybeSingle();
  if (!customer) notFound();

  const sp = await searchParams; // F1: ?lp= and ?ip= page numbers

  // PB-10 + F1: ALL loans, but only the small columns (no payments). The counts and the score need every loan,
  // and these rows are small. Payments and renewals are loaded below, only for the loans on the current page.
  const [{ data: loans }, { count: itemCount }, { data: weightRows }] = await Promise.all([
    supabase
      .from("loans")
      .select(
        "id, ticket_number, principal_amount, principal_balance, interest_owed, interest_rate_percent, interest_accrued_through, grace_period_days, liquidated_damages_percent, damages_owed, damages_accrued_through, status, loan_date, maturity_date, extension_count, late_payment_count, defaulted_at, reinstated_at, redeemed_at, archived_at, appraisal_item_id",
      )
      .eq("customer_id", id)
      .order("loan_date", { ascending: false })
      .order("id"), // F1: a fixed order, so pages never repeat or skip a loan
    // F1: only how many items there are (no rows yet); the page of items is loaded below
    supabase.from("appraisal_items").select("id", { count: "exact", head: true }).eq("customer_id", id).is("archived_at", null),
    supabase.from("score_weights").select("key, value"),
  ]);
  const loanHistory = (loans ?? []).map((l) => ({ ...l, loan_payments: [], loan_extensions: [] })) as unknown as LoanHistoryRow[]; // payments are filled in for the shown page below
  // Item 6: archived loans still count toward history and score.
  const today = manilaToday(); // today's date in Manila
  const history = computeCustomerScore(loanHistory, today, weightsFromRows(weightRows));
  const openLoans = loanHistory.filter((l) => l.status === "active" || l.status === "extended" || l.status === "reinstated");
  // F2: the SAME rule the database uses to refuse archiving (archive_record): active, renewed, reinstated or defaulted loans
  const blockingLoans = loanHistory.filter((l) => ["active", "extended", "reinstated", "defaulted"].includes(l.status));
  const canEdit = hasRole(role, ["operator"]);
  // PR8: loans that still need something first (open, or defaulted = waiting for forfeit), then the rest, each group newest first.
  // filter() keeps the original newest-first order inside each group.
  const needsAction = (l: LoanHistoryRow) => ["active", "extended", "reinstated", "defaulted"].includes(l.status); // still owes money
  const actionLoans = loanHistory.filter(needsAction); // open + defaulted
  const sortedLoans = [...actionLoans, ...loanHistory.filter((l) => !needsAction(l))]; // those first, then closed ones
  // F1: pages of 5 loans. Loans that still owe money come first (page 1), then the rest, newest first.
  const loanPages = Math.max(1, Math.ceil(sortedLoans.length / LOAN_PAGE)); // e.g. 23 loans -> 5 pages
  const lp = pageNo(sp.lp, loanPages); // the loans page being shown
  const pageLoans = sortedLoans.slice((lp - 1) * LOAN_PAGE, lp * LOAN_PAGE); // only these 5 get cards
  // F1: payments and renewals for the 5 loans on this page only (not for the whole history)
  const pageIds = pageLoans.map((l) => l.id); // the ids of the shown loans
  const itemPages = Math.max(1, Math.ceil((itemCount ?? 0) / ITEM_PAGE)); // pages of 5 items
  const ip = pageNo(sp.ip, itemPages); // the items page being shown
  const [{ data: pays }, { data: exts }, { data: appraisals }] = await Promise.all([
    pageIds.length ? supabase.from("loan_payments").select("id, loan_id, amount, receipt_number, created_at").in("loan_id", pageIds) : Promise.resolve({ data: [] }),
    pageIds.length ? supabase.from("loan_extensions").select("id, loan_id, new_maturity_date, additional_interest_amount, capitalized_amount, extension_type, created_at").in("loan_id", pageIds) : Promise.resolve({ data: [] }),
    // F1: one page of items, newest first, with a fixed order so pages don't overlap
    supabase
      .from("appraisal_items")
      .select("id, category, category_other, weight_grams, karat, computed_value, is_counterfeit_risk, counterfeit_resolution, created_at, status")
      .eq("customer_id", id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .order("id")
      .range((ip - 1) * ITEM_PAGE, ip * ITEM_PAGE - 1),
  ]);
  // put each payment and renewal under its own loan (only the shown loans)
  for (const l of pageLoans) {
    l.loan_payments = ((pays ?? []) as (LoanHistoryRow["loan_payments"][number] & { loan_id: string })[]).filter((p) => p.loan_id === l.id);
    l.loan_extensions = ((exts ?? []) as (LoanHistoryRow["loan_extensions"][number] & { loan_id: string })[]).filter((e) => e.loan_id === l.id);
  }
  // PR13: for the items on this page only: their vault record (custody) and their loan (ticket)
  const itemIds = (appraisals ?? []).map((a) => a.id); // the shown items
  const { data: vault } = itemIds.length
    ? await supabase.from("inventory_items").select("appraisal_item_id, status").in("appraisal_item_id", itemIds)
    : { data: [] as { appraisal_item_id: string; status: string }[] };
  const vaultByItem = new Map((vault ?? []).map((v) => [v.appraisal_item_id, v.status as string])); // item id -> vault status
  // the newest loan for each item (loans are already newest first, so the first one found is the newest)
  const loanByItem = new Map<string, LoanHistoryRow>();
  for (const l of loanHistory) if (l.appraisal_item_id && !loanByItem.has(l.appraisal_item_id)) loanByItem.set(l.appraisal_item_id, l);
  const base = `/dashboard/customers/${customer.id}`; // the profile address, for the pagers
  const canLend = hasRole(role, ["cashier"]); // PR8: who sees New loan (Cashier and Admin), same rule as the header button
  const blocked = customer.is_blacklisted;
  // PR4: a copy of the customer with the ID number masked ("•••• 0418"). Only this copy is given to the
  // forms that run in the browser, so the full ID never leaves the server from this page.
  // The eye button asks the server for the full number (role checked again there).
  const safeCustomer = { ...customer, id_number: maskId(customer.id_number) };

  return (
    // PR6: space-y-5 = a little less space between sections than before (was space-y-6)
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {customer.full_name}
            {/* C9: wrapper for the badges. font-sans = normal font instead of the serif title font, gap-2 = small space between badges */}
            <span className="flex flex-wrap items-center gap-2 font-sans">
              {/* the customer's score badge (e.g. "Good 85") */}
              <ScoreBadge score={history.score} tier={history.tier} />
              {/* PR7: the score is shown only here now (not again in Loan record); the (i) explains it */}
              <InfoTip label="Score">{SCORE_HELP}</InfoTip>
              {/* red badge, only shows if the customer is blacklisted */}
              {blocked && <Badge tone="danger">Blacklisted</Badge>}
              {/* gray badge, only shows if the customer is archived */}
              {customer.archived_at && <Badge tone="neutral">Archived</Badge>}
              {/* yellow badge, only shows if the customer is AML flagged */}
              {customer.aml_status === "flagged" && <Badge tone="warning">AML flagged</Badge>}
            {/* end of the badges wrapper */}
            </span>
          </span>
        }
        // #18: the short number first, so staff can read it out or write it on a form
        description={`${customerNo(customer.customer_no)} · Customer since ${formatDate(customer.created_at)}. ${openLoans.length} open loan${openLoans.length === 1 ? "" : "s"}.`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Customers", href: "/dashboard/customers" },
          { label: customer.full_name },
        ]}
        actions={
          !blocked && (
            <>
              {hasRole(role, ["cashier"]) && (
                <ButtonLink href={`/dashboard/loans/new?customer=${customer.id}`} variant="primary">
                  New loan
                </ButtonLink>
              )}
            </>
          )
        }
      />

      {blocked && (
        <Alert tone="danger" title="Blacklisted. Do not issue new loans.">
          {customer.blacklist_reason ? `Reason: ${customer.blacklist_reason}` : "No reason recorded."}
        </Alert>
      )}
      {customer.aml_status === "flagged" && (
        <Alert tone="warning" title="AML identity check flagged this customer">
          {customer.aml_notes}
        </Alert>
      )}

      {history.hasWarnings && (
        <Alert tone="warning" title="History warning">
          {[
            history.counts.delinquent && `${history.counts.delinquent} loan(s) paid late`,
            history.counts.reinstated && `${history.counts.reinstated} reinstated`,
            history.counts.defaulted && `${history.counts.defaulted} defaulted`,
          ]
            .filter(Boolean)
            .join(", ")}
          .
        </Alert>
      )}
      {/* PR1: top row = who the customer is (left) and their loan record (right), side by side from 1280px.
          Both are short, so the two columns end at about the same height (no big empty area).
          PR11: an even 50/50 split, the same as the Loans/Items row below, so the edges line up */}
      <div className="grid gap-5 xl:grid-cols-2">
        {/* left half: contact and ID. min-w-0 = can shrink on small screens instead of pushing the page sideways */}
        <section className="min-w-0" aria-label="Customer details">
          {/* the card. Operator/Admin get an Edit button that opens the form right here */}
          <ContactDetails customer={safeCustomer} canEdit={canEdit}>
            {/* what everyone sees: the saved details. Empty optional fields say "Not recorded" instead of a dash */}
            <DetailGrid
              items={[
                { label: "Contact", value: customer.contact_number },
                // PR12: [overflow-wrap:anywhere] = a very long email with no spaces breaks onto the next line instead of pushing the card wider than a phone screen
                { label: "Email", value: customer.email ? <span className="[overflow-wrap:anywhere]">{breakableEmail(customer.email)}</span> : <span className="text-slate-500">Not recorded</span> }, // PR13: breaks at @ and dots
                { label: "Date of birth", value: customer.date_of_birth ? formatDate(customer.date_of_birth) : <span className="text-slate-500">Not recorded</span> },
                // PR12: same for a long address
                { label: "Address", value: <span className="[overflow-wrap:anywhere]">{customer.address}</span> },
                { label: "ID type", value: customer.id_type },
                // P3: masked for everyone. Admin, Operator and Cashier get the eye button (the server checks the role)
                {
                  label: "ID number",
                  value: <IdReveal customerId={customer.id} masked={maskId(customer.id_number)} ending={idEnding(customer.id_number)} canReveal={hasRole(role, ID_REVEAL_ROLES)} />,
                },
              ]}
            />
          {/* end of the Customer details card */}
          </ContactDetails>
        {/* end of the left side */}
        </section>

        {/* right half: the loan record (same numbers as before) */}
        <section className="min-w-0" aria-label="Loan record">
          <Card className="h-full">
            {/* the card title */}
            <h2 className="mb-3 text-lg font-semibold text-slate-900">Loan record</h2>
            {/* PR7: the score moved up next to the name (it was shown twice). 8 counts in 4 columns = 2 rows,
                so this card is about as tall as Customer details. 2 columns on phones */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
              {[
                ["Total loans", history.counts.total],
                ["Open", history.counts.active],
                ["Redeemed", history.counts.redeemed],
                ["Renewed", history.counts.renewed],
                ["Paid late", history.counts.delinquent],
                ["Reinstated", history.counts.reinstated],
                ["Defaulted", history.counts.defaulted],
                ["Overdue now", history.counts.overdue],
              ].map(([label, count]) => (
                // one count: small label on top, the number under it (same look as Customer details)
                <div key={label}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                  <dd className="mt-0.5 text-sm tabular-nums text-slate-900">{count}</dd>
                {/* end of one count */}
                </div>
              ))}
            {/* end of the counts */}
            </dl>
          {/* end of the Loan record card */}
          </Card>
        {/* end of the right side */}
        </section>
      {/* end of the top row */}
      </div>

      {/* PR8: Loans (left) and Items (right) side by side from 1280px. PR13: compact cards and 4 per page,
          so the two columns stay a similar height. On smaller screens Items goes under Loans. */}
      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
        {/* left: the loans */}
        <section className="min-w-0" aria-labelledby="loans-title">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              {/* CP1 (Nov 14, page check): one "i" next to the heading explains Owed now for every loan card below (the same
                  button as the Score above and on the Loans list / Dashboard: click, Enter or tap opens it, Esc closes it).
                  Next to the heading, not inside it, so the heading's name stays "Loans and transactions". */}
              <div className="flex items-center gap-1.5">
                <h2 id="loans-title" className="text-lg font-semibold text-slate-900">Loans and transactions</h2>
                <InfoTip label="Owed now">{OWED_NOW_HELP}</InfoTip>
              </div>
              <p className="mt-0.5 text-sm text-slate-500">Loans that still owe money first, then the rest, newest first.</p>
            </div>
            {/* PR13: See all, with this customer already filled in on the Loans page */}
            {loanHistory.length > LOAN_PAGE && (
              <Link href={`/dashboard/loans?status=all&q=${encodeURIComponent(customer.full_name)}`} className="text-sm font-medium text-navy-700 underline underline-offset-2">
                See all {loanHistory.length} loans
              </Link>
            )}
          </div>
          {loanHistory.length === 0 ? (
            <Card padded={false}>
              <EmptyState
                title="No loans yet"
                description="Loans, payments, renewals and redemptions appear here once a loan is created for this customer."
                // PR8: a New loan button right here, for Cashier/Admin, unless the customer is blacklisted
                action={canLend && !blocked ? <ButtonLink href={`/dashboard/loans/new?customer=${customer.id}`} variant="primary">New loan</ButtonLink> : undefined}
              />
            </Card>
          ) : (
            // the loan cards, one under the other
            <div className="space-y-2">
              {pageLoans.map((loan) => {
                // C1: still owed = principal left + interest, INCLUDING interest that piled up
                // after the due date, + liquidated damages after the grace days (LD, 0073; same as the loan page).
                // Defaulted loans still owe money too.
                const owes = loan.status === "active" || loan.status === "extended" || loan.status === "reinstated" || loan.status === "defaulted";
                const owed = owes ? owedNow(loan, today) : 0; // LD (0073): the shared rule (principal + interest + liquidated damages)
                // the status word and colour, same as the Dashboard
                const label = loanLabel(loan, owed, today);
                // PR13: one summary line instead of listing every payment (the full list is on View loan)
                const pays = [...loan.loan_payments].sort((x, y) => y.created_at.localeCompare(x.created_at)); // newest first
                const renewals = loan.loan_extensions.filter((e) => e.extension_type !== "capitalized").length; // cash renewals
                const capitalized = loan.loan_extensions.length - renewals; // no-cash capitalizations
                const summary = [
                  pays.length ? `${pays.length} payment${pays.length === 1 ? "" : "s"}, latest ${formatPeso(pays[0].amount)} on ${formatDate(pays[0].created_at)}` : "No payments yet",
                  renewals ? `${renewals} renewal${renewals === 1 ? "" : "s"}` : "",
                  capitalized ? `${capitalized} capitalized` : "",
                ].filter(Boolean).join(" · ");
                return (
                  // PR13: compact card: 2 rows + 1 summary line. p-4 instead of p-5
                  <Card key={loan.id} padded={false} className="min-w-0 p-4">
                    {/* row 1: ticket + status (left), amount owed (right, the biggest number) */}
                    {/* PR13: no wrapping here, so "Owed now" always stays on the right; the left side wraps its own text instead */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          {/* break-all = a long ticket number wraps instead of pushing the card wider */}
                          <span className="break-all font-mono text-sm font-medium">{loan.ticket_number}</span>
                          {/* C2 + C3 + C8: same status words as the Dashboard */}
                          <StatusBadge status={label.badge} label={label.label} />
                          {loan.archived_at && <Badge tone="neutral">Archived</Badge>}
                        </span>
                        {/* row 2: dates and the original amount, small */}
                        <p className="mt-1 text-xs text-slate-600">
                          Issued {formatDate(loan.loan_date)} · Due {formatDate(loan.maturity_date)}
                          {/* C3: "1 time" / "2 times" */}
                          {loan.extension_count > 0 ? ` · Renewed ${loan.extension_count} time${loan.extension_count === 1 ? "" : "s"}` : ""} · Original principal{" "}
                          <span className="tabular-nums">{formatPeso(loan.principal_amount)}</span>
                        </p>
                      </div>
                      {/* C1 + PR9: what's owed today, shown for open AND defaulted loans */}
                      {owes && (
                        // CP1: no more hover-only title here (it couldn't be opened with the keyboard or on a phone); the "i" next to
                        // "Loans and transactions" explains Owed now. Before: title="Unpaid principal + interest (...) + liquidated damages ..."
                        <div className="shrink-0 text-right">
                          <p className="text-xs text-slate-600">Owed now</p>
                          <p className="text-lg font-semibold leading-tight tabular-nums text-navy-900">{formatPeso(owed)}</p>
                        </div>
                      )}
                    {/* end of rows 1 and 2 */}
                    </div>
                    {/* the summary line + View loan, split by a thin line */}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
                      <span className="min-w-0">{summary}</span>
                      <ViewButton href={`/dashboard/loans/${loan.id}`}>View loan</ViewButton>
                    </div>
                  </Card>
                );
              })}
              {/* F1 + PR13: same pager as the Items list */}
              <HistoryPager base={base} param="lp" page={lp} pages={loanPages} total={sortedLoans.length} size={LOAN_PAGE} other={{ ip }} />
            {/* end of the loan cards */}
            </div>
          )}
        {/* end of the left side */}
        </section>

        {/* right: the items this customer brought in */}
        <section className="min-w-0" aria-labelledby="items-title">
          <div className="mb-3">
            <h2 id="items-title" className="text-lg font-semibold text-slate-900">Items</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Newest first. {itemCount ?? 0} item{itemCount === 1 ? "" : "s"}, with the loan each one is pawned under.
            </p>
          </div>
          <Card padded={false}>
            {(itemCount ?? 0) > 0 && appraisals ? (
              <>
                <ul className="divide-y divide-slate-100">
                  {appraisals.map((a) => {
                    const loan = loanByItem.get(a.id); // the loan this item is pawned under (if any)
                    const where = custody(vaultByItem.get(a.id), loan, a.status, today); // where the item is now
                    return (
                      // PR10 + PR13: what it is, its value, its loan ticket and where it is now; button on the right
                      <li key={a.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 py-3 text-sm">
                        <div className="min-w-0">
                          {/* what the item is */}
                          <p className="font-medium text-slate-900 [overflow-wrap:anywhere]">
                            {categoryLabel(a.category, a.category_other)}, {a.karat}K, {a.weight_grams} g
                          </p>
                          {/* PR10: the value worked out at appraisal; PR13: the loan ticket, which opens that loan */}
                          <p className="mt-0.5 text-xs text-slate-600">
                            Appraised value <span className="font-medium tabular-nums text-slate-800">{formatPeso(a.computed_value)}</span>
                            {loan && (
                              <>
                                {" · Ticket "}
                                <Link href={`/dashboard/loans/${loan.id}`} className="break-all font-mono text-navy-700 underline underline-offset-2">
                                  {loan.ticket_number}
                                </Link>
                              </>
                            )}
                          </p>
                          {/* PR13: where the item is now (vault record), and the counterfeit check if any */}
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={where.badge} label={where.label} />
                            {a.is_counterfeit_risk && (
                              <StatusBadge status={a.counterfeit_resolution ?? "pending"} label={a.counterfeit_resolution === "cleared" ? "Cleared" : a.counterfeit_resolution === "confirmed" ? "Confirmed risk" : "Counterfeit review"} />
                            )}
                          </span>
                        </div>
                        <ViewButton href={`/dashboard/appraisals/${a.id}`}>View appraisal</ViewButton>
                      </li>
                    );
                  })}
                {/* end of the items */}
                </ul>
                {/* F1 + PR13: same pager as the Loans list */}
                {(itemCount ?? 0) > ITEM_PAGE && (
                  <div className="border-t border-slate-100 px-4 py-3">
                    <HistoryPager base={base} param="ip" page={ip} pages={itemPages} total={itemCount ?? 0} size={ITEM_PAGE} other={{ lp }} />
                  </div>
                )}
              </>
            ) : (
              <EmptyState title="No items appraised yet" description="Items show here once an Appraiser records one for this customer." />
            )}
          </Card>
        {/* end of the right side */}
        </section>
      {/* end of Loans and Items */}
      </div>

      {/* PR3: Admin actions, at the bottom and closed by default. Each row opens its own form when clicked.
          <details> is the browser's built-in open/close box: it works with the keyboard (Enter/Space) and screen readers.
          Only an Admin sees this; the server actions also check for Admin, so hiding it is not the only protection. */}
      {role === "admin" && (
        <section>
          <SectionTitle description="Rarely needed. Each action asks you to confirm and is saved in the audit trail.">Admin actions</SectionTitle>
          {/* one card, rows split by thin lines */}
          <Card padded={false} className="divide-y divide-slate-200">
            {/* row 1: Correct identity */}
            <details className="group">
              {/* the clickable row. list-none hides the browser's own triangle; our arrow turns when open */}
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-500 [&::-webkit-details-marker]:hidden">
                <span>
                  {/* the row title */}
                  <span className="block font-medium text-slate-900">Correct identity</span>
                  {/* what it does, in one line */}
                  <span className="block text-sm text-slate-500">Fix a wrong name or ID. Needs a reason, and the change is saved in the audit trail.</span>
                </span>
                {/* the arrow: points down when closed, up when open (group-open) */}
                <Icon name="chevron-down" className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
              {/* end of the clickable row */}
              </summary>
              {/* the form, only visible when the row is open. max-w-3xl = normal form width, not the whole screen */}
              <div className="max-w-3xl px-5 pb-5 pt-1">
                <AdminIdentityForm customer={safeCustomer} />
              </div>
            {/* end of row 1 */}
            </details>

            {/* row 2: Archive customer */}
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-500 [&::-webkit-details-marker]:hidden">
                <span>
                  <span className="block font-medium text-slate-900">Archive customer</span>
                  {/* PR5: the row says up front when archiving isn't possible */}
                  <span className="block text-sm text-slate-500">
                    {customer.archived_at
                      ? "Already archived."
                      : blockingLoans.length > 0
                        ? `Not available: ${blockingLoans.length} loan${blockingLoans.length === 1 ? "" : "s"} still open or waiting for forfeit.`
                        : "Hide this customer from lists. Nothing is deleted."}
                  </span>
                </span>
                <Icon name="chevron-down" className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
              </summary>
              <div className="max-w-3xl space-y-3 px-5 pb-5 pt-1 text-sm text-slate-600">
                {/* PR5: explains what archiving does before the form */}
                <p>
                  Archiving hides the customer from lists, search and counts. Their loans, payments and items are kept, and an Admin can
                  restore them from the <Link href="/dashboard/archive" className="font-medium text-navy-700 underline underline-offset-2">Archive page</Link>.
                </p>
                {customer.archived_at ? (
                  // already archived: nothing to do here
                  <p className="font-medium text-slate-700">This customer is already archived.</p>
                ) : blockingLoans.length > 0 ? (
                  // PR5: same rule as before (no archiving while loans are open), now explained instead of just hidden
                  <p className="font-medium text-slate-700">
                    {/* F2: same rule as the database: open AND defaulted (waiting for forfeit) loans block archiving */}
                    This customer can&apos;t be archived while a loan is still open or waiting for forfeit. Redeem or forfeit the loan{blockingLoans.length === 1 ? "" : "s"} first.
                  </p>
                ) : (
                  // the existing archive form (reason + confirm), unchanged
                  <ArchiveForm table="customers" id={customer.id} label="Customer" />
                )}
              </div>
            {/* end of row 2 */}
            </details>

            {/* row 3: Blacklist. The current status shows on the row itself, without opening it */}
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-500 [&::-webkit-details-marker]:hidden">
                <span>
                  <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                    Blacklist
                    {/* PR5: current status, as a word (not only a color) */}
                    {blocked ? <Badge tone="danger">Blacklisted</Badge> : <Badge tone="neutral">Not blacklisted</Badge>}
                  </span>
                  <span className="block text-sm text-slate-500">
                    {blocked ? "Remove the block when the case is settled." : "Block this customer from new appraisals and loans."}
                  </span>
                </span>
                <Icon name="chevron-down" className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
              </summary>
              <div className="max-w-3xl px-5 pb-5 pt-1">
                {/* the existing blacklist form (reason + confirm), unchanged */}
                <BlacklistForm customer={safeCustomer} />
              </div>
            {/* end of row 3 */}
            </details>
          {/* end of the Admin actions card */}
          </Card>
        </section>
      )}
    </div>
  );
}