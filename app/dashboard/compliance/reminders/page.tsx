import Link from "next/link"; // normal links (customer profile, loan, filters)
import { redirect } from "next/navigation"; // sends an old page link back to page 1
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import {
  DUE_FILTERS,
  REMINDER_LEAD_DAYS,
  dueLabel,
  dueRange,
  reminderWindowEnd,
  type DueFilter,
} from "@/lib/compliance/reminders"; // R1: the Manila-date rules for the list
import { buildQueue, type QueueLoan, type QueueLog, type ReminderView } from "@/lib/compliance/reminder-queue"; // R1: summary, tabs, order
import { methodLabel, outcomeBadge } from "@/lib/compliance/reminder-outcomes"; // R3: words for how and what happened
import { STILL_OWES_FILTER } from "@/lib/loans/display"; // "still owes money" as a database filter (same rule as Loans)
import { owedNow } from "@/lib/loans/status"; // what the customer owes today (same amount as Loans and the Dashboard)
import { formatDate, formatDateTime, formatPeso, manilaToday } from "@/lib/format";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Pagination, Table, TBody, TD, TH, THead, TR, pageParam } from "@/components/ui";
import { ViewTabs, ViewToolbar } from "@/components/view-tabs"; // D1: the same tab row as every other page
import { NavSelect } from "@/components/nav-select"; // D2: the same dropdown as Inventory's Category
import { Icon } from "@/components/icons";
import { RemindersSearch } from "./reminders-search";
import { LogContactButton } from "./log-contact-button";
import { CopyNumber } from "./copy-number"; // R2: copy the mobile number
import { InfoTip } from "../../customers/info-tip"; // the same "i" help button as on Customers and Loans

export const metadata = { title: "Reminders" };

const PAGE_SIZE = 10; // same as Customers, Appraisals and Loans, so the list fits one screen
const BASE = "/dashboard/compliance/reminders";
// R3: 4 tabs. To contact = not contacted yet or no answer; Needs follow-up = wrong number or follow-up needed;
// Contact made = reached or message sent
const TABS: Record<ReminderView, string> = { todo: "To contact", followup: "Needs follow-up", logged: "Contact made", all: "All" };

// "Nov 9" (no year), for the short date ranges in the Due dropdown and summary
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "UTC" });
}
// "Nov 9" or "Nov 10–11" / "Nov 30–Dec 2"
function shortRange(from: string, to: string): string {
  if (from === to) return shortDate(from);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `${shortDate(from)}–${sameMonth ? Number(to.slice(8, 10)) : shortDate(to)}`;
}

export default async function RemindersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; due?: string; q?: string; page?: string; customer?: string }>;
}) {
  // Cashier and Admin only (Admin always passes). Operator and Appraiser are sent away, same as before.
  // The database also only lets a Cashier or Admin add a reminder log (reminder_log RLS).
  await requireRole(["cashier", "admin"]);
  // R1: opening this page only READS loans. It never runs default detection or changes a loan.

  const params = await searchParams;
  const view: ReminderView = params.view === "followup" || params.view === "logged" || params.view === "all" ? params.view : "todo"; // default tab: To contact
  const due: DueFilter = DUE_FILTERS.includes(params.due as DueFilter) ? (params.due as DueFilter) : "all";
  const q = params.q?.trim().slice(0, 60) || undefined;
  const page = pageParam(params.page);
  // R2: one customer's loans (the "3 loans due" link). A customer id is a UUID; anything else is ignored
  const customerId = params.customer && /^[0-9a-f-]{36}$/i.test(params.customer) ? params.customer : null;
  const today = manilaToday(); // the shop's date (Asia/Manila), not the computer's
  const windowEnd = reminderWindowEnd(today); // today + 3 days

  const supabase = await createClient();

  // search by customer name or mobile number (typed any way: 0917 123 4567, +63 917...), same as Loans
  const safe = q ? q.replace(/[%,()*"\\]/g, " ").trim() : "";
  let searchOr: string | null = null;
  if (safe) {
    const ors = [`full_name.ilike.%${safe}%`];
    const digits = safe.replace(/\D/g, "");
    if (/^[+\d\s-]+$/.test(safe) && digits.length >= 4) {
      const local = digits.startsWith("63") && digits.length > 4 ? `0${digits.slice(2)}` : digits; // 63917... -> 0917...
      ors.push(`contact_number.ilike.%${local}%`);
    }
    const { data: matches } = await supabase.from("customers").select("id").or(ors.join(",")).limit(200);
    const customerIds = (matches ?? []).map((c) => c.id);
    // the search as one "or": the ticket number, or one of the customers found above
    searchOr = customerIds.length ? `ticket_number.ilike.%${safe}%,customer_id.in.(${customerIds.join(",")})` : `ticket_number.ilike.%${safe}%`;
  }

  // R1: the loans on the list, asked from the DATABASE (not every open loan any more):
  // running (Active, Renewed, Reinstated), not archived, due today up to 3 days from now, and still owing money.
  // Fully paid loans waiting for release are left out (same rule as the Dashboard's "Send reminders" count).
  // Only 3 small columns here; the full details are loaded below for the 10 loans on this page.
  const windowQuery = (extraOr: string | null) =>
    supabase
      .from("loans")
      .select("id, customer_id, maturity_date")
      .in("status", ["active", "extended", "reinstated"])
      .is("archived_at", null)
      .gte("maturity_date", today)
      .lte("maturity_date", windowEnd)
      .or(extraOr ? `and(or(${STILL_OWES_FILTER}),or(${extraOr}))` : STILL_OWES_FILTER) // both "or" groups at once, like Loans
      .order("maturity_date")
      .order("id");

  // #36: the whole list in ONE call. The database function reminder_queue (migration 0039) returns every loan on the
  // list with its contact logs (archived logs left out, newest first), by the same rules as windowQuery above.
  // Before, the page asked for the loans and then for their logs in groups of 150.
  const [{ data: queueRows, error }, searchResult] = await Promise.all([
    supabase.rpc("reminder_queue", { p_lead_days: REMINDER_LEAD_DAYS }), // the whole list (summary + tab counts)
    searchOr ? windowQuery(searchOr) : Promise.resolve(null), // only the loans the search finds
  ]);
  if (error) throw error;
  if (searchResult?.error) throw searchResult.error;
  const loans: QueueLoan[] = (queueRows ?? []).map((r) => ({ id: r.id, customer_id: r.customer_id, maturity_date: r.maturity_date }));
  const matchIds = searchResult ? new Set((searchResult.data ?? []).map((l) => l.id)) : null;
  // every log of those loans in one flat list (each log carries its loan_id), as buildQueue expects
  const logs: QueueLog[] = (queueRows ?? []).flatMap((r) => (Array.isArray(r.logs) ? (r.logs as unknown as QueueLog[]) : []));

  // summary, tab counts and the list in order (lib/compliance/reminder-queue.ts, tested)
  const { summary, counts, list } = buildQueue(loans, logs, { today, view, due, matchIds, customerId });

  // links keep the tab, Due filter and search
  const listParams = { view: view === "todo" ? undefined : view, due: due === "all" ? undefined : due, q, customer: customerId ?? undefined };
  const href = (overrides: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...listParams, ...overrides })) if (v) qs.set(k, v);
    const s = qs.toString();
    return s ? `${BASE}?${s}` : BASE;
  };

  // a page past the end (an old link, or the last row on a page was just logged): back to page 1
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (page > pages) redirect(href({ page: undefined }));
  const pageItems = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // full details for the (up to) 10 loans on this page only
  type Detail = {
    id: string;
    ticket_number: string;
    maturity_date: string;
    principal_balance: number;
    interest_owed: number;
    interest_rate_percent: number;
    interest_accrued_through: string | null;
    status: string;
    customers: { id: string; full_name: string; contact_number: string | null } | null;
  };
  const detailById = new Map<string, Detail>();
  const staffNames = new Map<string, string>();
  if (pageItems.length) {
    const staffIds = [...new Set(pageItems.flatMap((i) => i.allLogs.map((l) => l.created_by)).filter((id): id is string => Boolean(id)))];
    const [{ data: details, error: detailError }, { data: staff }] = await Promise.all([
      supabase
        .from("loans")
        .select("id, ticket_number, maturity_date, principal_balance, interest_owed, interest_rate_percent, interest_accrued_through, status, customers(id, full_name, contact_number)")
        .in("id", pageItems.map((i) => i.id)),
      staffIds.length ? supabase.from("profiles").select("id, full_name").in("id", staffIds) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    ]);
    if (detailError) throw detailError;
    for (const d of (details ?? []) as unknown as Detail[]) detailById.set(d.id, d);
    for (const s of staff ?? []) staffNames.set(s.id, s.full_name);
  }
  const rows = pageItems.flatMap((item) => {
    const d = detailById.get(item.id);
    return d ? [{ ...item, d }] : []; // skip a loan that changed between the two reads (it shows correctly on reload)
  });
  type Row = (typeof rows)[number];

  // pieces used by both the table (computers) and the cards (phones).
  // On phones the small links get py-1, so each is at least 24px tall and easy to tap; the table keeps them compact.
  const staffName = (id: string | null) => (id ? (staffNames.get(id) ?? "a staff member") : "a staff member");
  const dueBadge = (daysLeft: number) =>
    // amber only for due today; tomorrow and later stay neutral, so the list isn't all yellow. The words always say it.
    daysLeft === 0 ? <Badge tone="warning">Due today</Badge> : daysLeft === 1 ? <Badge>Due tomorrow</Badge> : <span className="text-xs text-slate-600">{dueLabel(daysLeft)}</span>;
  const customerLink = (r: Row) =>
    r.d.customers ? (
      <Link
        href={`/dashboard/customers/${r.d.customers.id}`}
        className="rounded-sm font-medium text-slate-900 underline-offset-2 hover:text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
      >
        {r.d.customers.full_name}
      </Link>
    ) : (
      <span className="text-slate-500">Unknown customer</span>
    );
  // "3 loans due": one customer with several tickets on the list. Opens All with that name searched, so they show together
  const multiBadge = (r: Row) =>
    r.loansDue > 1 && r.d.customers ? (
      <Link
        // R2: by the customer's id (not the name), so another customer with the same name never shows up
        href={href({ view: "all", due: undefined, q: undefined, customer: r.d.customers.id, page: undefined })}
        className="whitespace-nowrap rounded-full bg-navy-50 px-2 py-1 text-xs min-[1100px]:py-0.5 font-semibold text-navy-700 ring-1 ring-inset ring-navy-200 hover:bg-navy-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
        title={`Show all ${r.loansDue} loans of ${r.d.customers.full_name} on this list`}
      >
        {r.loansDue} loans due
      </Link>
    ) : null;
  const phone = (r: Row) =>
    r.d.customers?.contact_number ? (
      <span className="flex items-center gap-1">
        {/* tel: = tapping it on a phone opens the dialer; nothing is called until the staff member presses call */}
        <a href={`tel:${r.d.customers.contact_number}`} className="inline-block py-1 text-xs text-navy-700 hover:underline min-[1100px]:py-0">
          {r.d.customers.contact_number}
        </a>
        <CopyNumber number={r.d.customers.contact_number} />
      </span>
    ) : (
      <span className="text-xs text-slate-500">No mobile on file</span>
    );
  const ticketLink = (r: Row) => (
    // the ticket opens the loan (the separate "View loan" button is gone)
    <Link
      href={`/dashboard/loans/${r.id}`}
      className="inline-block whitespace-nowrap rounded-sm py-1 font-mono text-xs text-navy-700 underline-offset-2 min-[1100px]:py-0 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
    >
      {r.d.ticket_number}
    </Link>
  );
  // R3: "Call · Nov 9, 2:15 PM · Ana" (the method is empty on logs from before 0027)
  const logLine = (l: QueueLog) => [methodLabel(l.contact_method), formatDateTime(l.sent_at), staffName(l.created_by)].filter(Boolean).join(" · ");
  const contactStatus = (r: Row) => {
    const last = r.cycleLogs[0]; // newest log for this due date
    const badge = last ? outcomeBadge(last.outcome) : null; // e.g. "No answer" (grey), "Wrong number" (red), "Reached" (green)
    const tries = r.cycleLogs.length; // how many logs for this due date
    return (
      <div className="max-w-xs text-xs">
        {last && badge ? (
          <>
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge tone={badge.tone}>{badge.label}</Badge>
              {tries > 1 && <span className="text-slate-500">{tries} tries</span>}
            </span>
            <span className="mt-0.5 block text-slate-600">{logLine(last)}</span>
            {/* the note, so the Admin sees it without opening anything */}
            {last.notes && <span className="mt-0.5 block break-words italic text-slate-700">&ldquo;{last.notes}&rdquo;</span>}
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
            {/* a small grey dot + words, so the rows still to do are easy to spot without coloring the row */}
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-slate-400" />
            Not contacted yet
          </span>
        )}
        {/* the history, folded away so rows stay short; only when there's more than the line above */}
        {(last ? r.allLogs.length > 1 : r.allLogs.length > 0) && (
          <details className="mt-0.5">
            <summary className="cursor-pointer rounded text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
              Contact history ({r.allLogs.length})
            </summary>
            <ul className="mt-1 space-y-1 text-slate-600">
              {r.allLogs.map((l, i) => (
                <li key={`${l.sent_at}-${i}`}>
                  <span className="font-medium text-slate-700">{outcomeBadge(l.outcome).label}</span> · {logLine(l)}
                  {/* a log from before the loan's current due date (before a renewal) */}
                  {!r.cycleLogs.includes(l) && <span className="text-slate-500"> (earlier due date)</span>}
                  {l.notes && <span className="block break-words italic">&ldquo;{l.notes}&rdquo;</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    );
  };
  const action = (r: Row) => (
    <LogContactButton
      loanId={r.id}
      ticketNumber={r.d.ticket_number}
      customerName={r.d.customers?.full_name ?? "this customer"}
      contactNumber={r.d.customers?.contact_number ?? ""}
      dueText={`${formatDate(r.d.maturity_date)} (${dueLabel(r.daysLeft)})`}
      again={r.state !== "none"} // R3: anything logged for this due date = "Log again"
    />
  );

  // the Due dropdown: each choice shows its dates, e.g. "Tomorrow (Nov 9)"
  const DUE_LABELS: Record<DueFilter, string> = { all: "All", today: "Today", tomorrow: "Tomorrow", later: "In 2–3 days" };
  const dueOptions = DUE_FILTERS.map((f) => {
    const [from, to] = dueRange(f, today);
    return { value: f, label: `${DUE_LABELS[f]} (${shortRange(from, to)})`, href: href({ due: f === "all" ? undefined : f, page: undefined }) };
  });
  const viewing = due === "all" ? TABS[view] : `${TABS[view]}, ${DUE_LABELS[due].toLowerCase()}`; // e.g. "To contact, tomorrow"
  // R2: the customer picked with "3 loans due" (their name comes from the loans on this page)
  const pickedCustomer = customerId ? (rows.find((r) => r.d.customers?.id === customerId)?.d.customers?.full_name ?? "this customer") : null;

  // the empty message fits what is empty
  const empty = (() => {
    if (summary.total === 0)
      return { title: "No reminders due", description: `No running loan that still owes money is due between today and ${formatDate(windowEnd)}.` };
    if (customerId) return { title: "No loans of this customer in this view", description: "Try the All tab, or clear the customer to see everyone." };
    if (q) return { title: "No reminders match your search", description: "Try the customer's full name, their mobile number or the full ticket number. The search looks only at loans on this list." };
    if (view === "todo") return { title: "No one left to contact", description: "Every loan in this view was reached or needs a follow-up. See Contact made and Needs follow-up." };
    if (view === "followup") return { title: "Nothing needs a follow-up", description: "Loans show here when a log says Wrong number or Follow-up needed." };
    if (view === "logged") return { title: "No contact made yet", description: "Loans show here after you log Reached or Message sent." };
    return { title: "No loans in this view", description: "Try another Due choice." };
  })();

  return (
    <div>
      <PageHeader
        title="Reminders"
        description={`Loans due today up to ${REMINDER_LEAD_DAYS} days from now that still owe money. Call or text the customer, then log the contact.`}
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Reminders" }]}
        // past-due loans aren't on this list; they are followed up on Loans
        actions={<ButtonLink href="/dashboard/loans?status=overdue">Overdue loans</ButtonLink>}
      />

      {/* R1: today's workload in one short row (each number opens that part of the list), with the manual-only
          notice under it in the same box, so together they take little space above the list */}
      <section aria-label="Today's reminders" className="mb-3 rounded-md border border-slate-200 bg-white">
        <dl className="grid grid-cols-3 divide-x divide-slate-200">
          {[
            { label: "Due today", value: summary.dueToday, hint: `loan${summary.dueToday === 1 ? "" : "s"} · ${shortDate(today)}`, href: href({ view: "all", due: "today", q: undefined, page: undefined }), warn: summary.dueToday > 0 },
            { label: "Due in 1–3 days", value: summary.dueSoon, hint: `loan${summary.dueSoon === 1 ? "" : "s"} · ${shortRange(dueRange("tomorrow", today)[0], windowEnd)}`, href: href({ view: "all", due: undefined, q: undefined, page: undefined }), warn: false },
            // R2: "of 51 loan reminders · 45 unique customers" = the counts are LOANS (each ticket has its own reminder),
            // and how many different people that is. R3: only reached / message sent count as contact made
            { label: "Contact made", value: summary.contacted, hint: `of ${summary.total} loan reminder${summary.total === 1 ? "" : "s"} · ${summary.customers} unique customer${summary.customers === 1 ? "" : "s"}`, href: href({ view: "logged", due: undefined, q: undefined, page: undefined }), warn: false },
          ].map((s) => (
            <div key={s.label}>
              {/* label on top, then the number and its words (the same in all 3 boxes, at every width) */}
              <Link href={s.href} className="block px-3 py-1.5 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-500 sm:px-4">
                <dt className="text-xs font-medium text-slate-600">{s.label}</dt>
                <dd className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className={`font-display text-xl font-semibold tabular-nums ${s.warn ? "text-amber-800" : "text-navy-900"}`}>{s.value}</span>
                  <span className="text-xs text-slate-500">{s.hint}</span>
                </dd>
              </Link>
            </div>
          ))}
        </dl>
        {/* the manual-only notice: small, so it doesn't compete with the list. Never says a message was sent */}
        <p className="flex items-start gap-2 border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 sm:px-4">
          <Icon name="info" className="mt-px h-3.5 w-3.5 shrink-0 text-navy-700" />
          <span>
            <strong className="font-semibold">Manual reminders only.</strong> PawnTrack does not send SMS or email automatically. Record customer
            contact after calling or messaging.
          </span>
        </p>
      </section>

      <Card padded={false}>
        {/* D1: the same tab row as the other pages */}
        <ViewTabs
          label="Reminder views"
          current={view}
          tabs={(Object.keys(TABS) as ReminderView[]).map((t) => ({
            value: t,
            label: TABS[t],
            count: counts[t],
            tone: t === "todo" || t === "followup" ? ("warning" as const) : undefined, // amber dot while there's work left
            href: href({ view: t === "todo" ? undefined : t, page: undefined }),
          }))}
        />
        {/* search + Due on the left, "Viewing" or "N matches" on the right */}
        <ViewToolbar viewing={viewing} matches={q || customerId ? list.length : undefined}>
          <div className="w-full sm:w-80">
            {/* typing a search leaves the one-customer view (keeps the tab and Due) */}
            <RemindersSearch defaultValue={q} keep={{ view: listParams.view, due: listParams.due }} />
          </div>
          <NavSelect label="Due" value={due} options={dueOptions} />
          {/* R2: one customer's loans: says whose, with a clear way back to everyone */}
          {pickedCustomer && (
            <span className="inline-flex items-center gap-1 rounded-full bg-navy-50 py-1 pl-3 pr-1 text-sm text-navy-800 ring-1 ring-inset ring-navy-200">
              Loans of <strong className="font-semibold">{pickedCustomer}</strong>
              <Link
                href={href({ customer: undefined, page: undefined })}
                aria-label={`Show all customers again, not only ${pickedCustomer}`}
                className="rounded-full p-1.5 text-navy-700 hover:bg-navy-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
              >
                <Icon name="x" className="h-3.5 w-3.5" />
              </Link>
            </span>
          )}
        </ViewToolbar>

        {rows.length > 0 ? (
          <>
            {/* CARDS below 1100px (phones, tablets, big zoom), same break as Loans: nothing scrolls sideways */}
            <ul className="divide-y divide-slate-100 min-[1100px]:hidden">
              {rows.map((r) => (
                <li key={r.id} className="px-4 py-3">
                  {/* line 1: customer + mobile on the left, owed on the right */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {customerLink(r)}
                        {multiBadge(r)}
                      </div>
                      {phone(r)}
                    </div>
                    <div className="shrink-0 text-right text-sm tabular-nums">
                      <span className="block text-xs text-slate-500">Owed now</span>
                      <span className="font-semibold text-navy-900">{formatPeso(owedNow(r.d, today))}</span>
                    </div>
                  </div>
                  {/* line 2: ticket and due date */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
                    {ticketLink(r)}
                    <span>· Due {formatDate(r.d.maturity_date)}</span>
                    {dueBadge(r.daysLeft)}
                  </div>
                  {/* line 3: contact status and the button */}
                  <div className="mt-2 flex items-start justify-between gap-3">
                    {contactStatus(r)}
                    {action(r)}
                  </div>
                </li>
              ))}
            </ul>

            {/* COMPUTERS (1100px and wider): the table. R2: no height limit and no scroll box inside the page, so there is
                only ONE scrollbar (the page's). 10 rows + the page buttons fit a 1080p screen; on shorter screens or zoomed
                in, the page scrolls a little instead of a second scrollbar inside the table */}
            <div className="hidden min-[1100px]:block">
              <Table minWidth="980px" className="[&_thead]:bg-slate-100 [&_thead]:text-slate-700 [&_th]:font-semibold">
                <THead>
                  <TH>Customer</TH>
                  <TH>Ticket</TH>
                  <TH>Due</TH>
                  <TH align="right">Owed now</TH>
                  <TH>
                    <span className="inline-flex items-center gap-1">
                      Contact
                      <InfoTip label="Contact">
                        The newest log for this loan: what happened (Reached, No answer, Wrong number...), how, when and who logged it,
                        plus any note. &quot;Attempt logged&quot; = an older log saved before results could be recorded. Each loan has its
                        own status, even for a customer with several loans.
                      </InfoTip>
                    </span>
                  </TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    // R1: no yellow rows; the "Due today" badge says it
                    <TR key={r.id}>
                      <TD>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {customerLink(r)}
                          {multiBadge(r)}
                        </div>
                        {phone(r)}
                      </TD>
                      <TD>{ticketLink(r)}</TD>
                      <TD className="whitespace-nowrap">
                        <span className="block">{formatDate(r.d.maturity_date)}</span>
                        {dueBadge(r.daysLeft)}
                      </TD>
                      <TD align="right" className="font-medium">
                        {formatPeso(owedNow(r.d, today))}
                      </TD>
                      <TD>{contactStatus(r)}</TD>
                      <TD align="right">{action(r)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.length} basePath={BASE} params={listParams} />
          </>
        ) : (
          <EmptyState
            icon="bell"
            title={empty.title}
            description={empty.description}
            action={
              summary.total === 0 ? (
                <ButtonLink href="/dashboard/loans?status=overdue" size="sm">
                  See overdue loans
                </ButtonLink>
              ) : undefined
            }
          />
        )}

        {/* help, folded away (same box as Loans and Customers) */}
        <details className="border-t border-slate-200 px-4 py-2.5 text-sm text-slate-600">
          <summary className="cursor-pointer rounded font-medium text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
            Which loans show here, and what does Log contact do?
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Active, Renewed and Reinstated loans due today up to {REMINDER_LEAD_DAYS} days from now (Manila date) that still owe money. Fully paid
              loans waiting for release are left out.
            </li>
            <li>
              Past the due date? Those loans leave this list. Follow them up on{" "}
              <Link href="/dashboard/loans?status=overdue" className="text-navy-700 underline">
                Loans → Overdue
              </Link>
              .
            </li>
            <li>
              <strong>Log contact</strong> records how you contacted the customer (call, SMS sent by hand, in person), what happened, and an optional
              note, with your name and the time. Log every try, even when nobody answers. It does not send anything.
            </li>
            <li>
              <strong>No answer</strong> keeps the loan in To contact. <strong>Wrong number</strong> and <strong>Follow-up needed</strong> move it to
              Needs follow-up, so an Admin can check the number or the problem. <strong>Reached</strong> and <strong>Message sent</strong> move it to
              Contact made.
            </li>
            <li>&quot;Attempt logged&quot; is an older log, saved before PawnTrack could record what happened.</li>
            <li>A renewed loan starts fresh: logs from its earlier due date stay in the contact history but don&apos;t count as contacted now.</li>
            <li>
              A customer with several loans shows &quot;N loans due&quot;; click it to see only that customer&apos;s loans. Each ticket has its own
              status and is logged on its own, so talking about one ticket doesn&apos;t mark the others.
            </li>
          </ul>
        </details>
      </Card>
    </div>
  );
}
