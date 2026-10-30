// Link = Next.js's clickable link (C7: the name opens the profile; C11: phone cards)
import Link from "next/link";
// R5: redirect = send the user to another address (used when a page number is past the last page)
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { hasRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDate, manilaToday } from "@/lib/format";
import { loadCustomerScores } from "@/lib/customers/history";
import { ScoreBadge } from "@/components/score-badge";
import {
  Badge,
  Card,
  EmptyState,
  FilterTabs,
  PageHeader,
  Pagination,
  SortTH,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  ActionsCell,
  ViewButton,
  pageParam,
  cx, // joins class names, and can add some only when a condition is true
} from "@/components/ui";
// U1: search while typing (customer-search.tsx)
import { CustomerSearch } from "./customer-search";
// U2: the Register button + popup (register-dialog.tsx)
import { RegisterCustomerDialog } from "./register-dialog";
// R2: the small "i" buttons with short explanations next to column headings (info-tip.tsx)
import { InfoTip } from "./info-tip";
// P3: masked ID with an eye button for allowed roles; EyeIcon also used on the Hide/Show IDs button (id-reveal.tsx)
import { IdReveal, EyeIcon } from "./id-reveal";
// P3: who may see full IDs, and the masking helpers (lib/customers/id-privacy.ts)
import { ID_REVEAL_ROLES, idEnding, maskId } from "@/lib/customers/id-privacy";

// R2 + R3: the explanations, written once and used both in the "i" boxes and in the help at the bottom.
// They describe what the code really does (lib/customers/score.ts, lib/customers/aml.ts).
const AML_HELP =
  "Checked once, when the customer is registered: the name and ID number are compared with the watchlist. Clear = no match. Flagged = possible match, so an Admin should review before lending. The check date shows when you hover the badge.";
const SCORE_HELP =
  "A guide from this customer's own loans at this shop, worked out each time the page opens. It is not a credit rating. Everyone with at least one loan starts at 60 (Fair). On-time redemptions and renewals add points; late payments, reinstated or defaulted loans, and loans overdue now take points away. Results older than 2 years count half. Excellent 85+, Good 70 to 84, Fair 50 to 69, Risky below 50. No history = no loans yet, not a bad score.";
const FLAGS_HELP =
  "Blacklisted = cannot get new loans. History warning = has paid late, been reinstated or defaulted before. None = neither. On screens narrower than 1536px this column is called Compliance and also shows the AML result (AML clear or AML flagged).";

export const metadata = { title: "Customers" };

// U3: 10 per page (was 25) so the table and the page buttons fit on a laptop screen
const PAGE_SIZE = 10;
const SORTS: Record<string, string> = { name: "full_name", registered: "created_at" };
// U4: the filter tabs. Only filters the database can answer quickly (no made-up statuses)
const SHOWS = ["all", "blacklisted", "aml"] as const;
type Show = (typeof SHOWS)[number];

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string; dir?: string; new?: string; show?: string; ids?: string }>;
}) {
  const user = await requireRole(["operator", "cashier", "appraiser", "admin"]);
  const params = await searchParams;
  const q = params.q?.trim();
  const page = pageParam(params.page);
  const sort = SORTS[params.sort ?? ""] ? params.sort! : "registered";
  const dir = params.dir === "asc" ? "asc" : params.dir === "desc" ? "desc" : sort === "name" ? "asc" : "desc";
  // U4: which filter tab is open ("all" if the address has something else)
  const show: Show = SHOWS.includes(params.show as Show) ? (params.show as Show) : "all";
  const canRegister = hasRole(user.profile.role, ["operator"]);
  // P3: may this person reveal a full ID? (Admin, Operator, Cashier; not Appraiser)
  const canReveal = hasRole(user.profile.role, ID_REVEAL_ROLES);
  // P2: "?ids=hide" = the whole ID column is hidden. Only the on/off choice is in the address, never an ID number.
  const hideIds = params.ids === "hide";

  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select("id, full_name, contact_number, id_type, id_number, aml_status, aml_checked_at, is_blacklisted, created_at", { count: "exact" })
    .is("archived_at", null)
    .order(SORTS[sort], { ascending: dir === "asc" })
    .order("id") // U3: same date or name -> always the same order, so nobody shows on two pages
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  // U4: the filter tab
  if (show === "blacklisted") query = query.eq("is_blacklisted", true);
  if (show === "aml") query = query.eq("aml_status", "flagged");
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    // the same searches as before: name, phone, ID number (partial, any capitals)
    const ors = [`full_name.ilike.%${safe}%`, `contact_number.ilike.%${safe}%`, `id_number.ilike.%${safe}%`];
    // U1: phone numbers typed any way (+63 917..., 0917-123-4567) still find the customer
    const digits = q.replace(/\D/g, ""); // digits only
    if (/^[+\d\s-]+$/.test(q) && digits.length >= 4) {
      const local = digits.startsWith("63") && digits.length > 4 ? `0${digits.slice(2)}` : digits; // 63917... -> 0917...
      ors.push(`contact_number.ilike.%${local}%`); // saved without spaces
      if (local.length >= 7) ors.push(`contact_number.ilike.%${local.split("").join("%")}%`); // saved with spaces or dashes
    }
    // U1: ID numbers typed without the dashes ("0000000418") still find "0000-000418"
    const idClean = q.replace(/[^a-z0-9]/gi, "");
    if (idClean.length >= 4) ors.push(`id_number.ilike.%${idClean.split("").join("%")}%`);
    query = query.or(ors.join(","));
  }
  // U4: the counts on the header and the filter tabs (all customers, not just this page)
  const countOf = (filter?: "blacklisted" | "aml") => {
    let c = supabase.from("customers").select("id", { count: "exact", head: true }).is("archived_at", null);
    if (filter === "blacklisted") c = c.eq("is_blacklisted", true);
    if (filter === "aml") c = c.eq("aml_status", "flagged");
    return c;
  };
  const [{ data: customers, count, error }, { count: totalAll }, { count: totalBlacklisted }, { count: totalAml }] = await Promise.all([
    query,
    countOf(),
    countOf("blacklisted"),
    countOf("aml"),
  ]);
  if (error) throw error;
  // R5: a page number past the last page (e.g. an old link to page 9 after a search) -> go to the last page instead of "no customers"
  if ((customers?.length ?? 0) === 0 && (count ?? 0) > 0 && page > 1) {
    const last = Math.ceil((count ?? 0) / PAGE_SIZE); // the last page that has customers
    const qs = new URLSearchParams(); // keep the search, filter and sort
    if (q) qs.set("q", q);
    if (params.sort) qs.set("sort", params.sort);
    if (params.dir) qs.set("dir", params.dir);
    if (show !== "all") qs.set("show", show);
    if (hideIds) qs.set("ids", "hide");
    if (last > 1) qs.set("page", String(last));
    const str = qs.toString();
    redirect(str ? `/dashboard/customers?${str}` : "/dashboard/customers");
  }
  const scores = await loadCustomerScores(supabase, (customers ?? []).map((c) => c.id), manilaToday());

  // what to keep in the address when sorting, paging or searching
  const listParams = { q, sort: params.sort, dir: params.dir, show: show === "all" ? undefined : show, ids: hideIds ? "hide" : undefined };
  // P2: address for the Hide/Show IDs button (keeps everything else, including the page)
  const idsHref = (() => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (params.sort) qs.set("sort", params.sort);
    if (params.dir) qs.set("dir", params.dir);
    if (show !== "all") qs.set("show", show);
    if (!hideIds) qs.set("ids", "hide"); // flip: shown -> hidden
    if (page > 1) qs.set("page", String(page));
    const str = qs.toString();
    return str ? `/dashboard/customers?${str}` : "/dashboard/customers";
  })();
  // U4: address for a filter tab (keeps the search and sort, goes back to page 1)
  const tabHref = (value: Show) => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (params.sort) qs.set("sort", params.sort);
    if (params.dir) qs.set("dir", params.dir);
    if (value !== "all") qs.set("show", value);
    if (hideIds) qs.set("ids", "hide");
    const str = qs.toString();
    return str ? `/dashboard/customers?${str}` : "/dashboard/customers";
  };

  return (
    <div>
      <PageHeader
        // U2: the total next to the title, in the normal font
        title={
          <>
            Customers
            <span className="ml-2 font-sans text-base font-normal tracking-normal text-slate-500">({totalAll ?? 0})</span>
          </>
        }
        description="Look up a customer to see their profile, loans and payment history."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Customers" }]}
        // U2: Register is a header button now (Operator and Admin only), not a big card above the list
        actions={canRegister ? <RegisterCustomerDialog defaultOpen={params.new === "1"} /> : undefined}
      />

      <Card padded={false}>
        {/* U1 + U4: search on the left, filter tabs on the right (they stack on small screens) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <CustomerSearch defaultValue={q} keep={{ show: listParams.show, sort: params.sort, dir: params.dir, ids: listParams.ids }} />
          {/* how many match, only when searching or filtering. Sits in this row so it adds no height.
              aria-live = screen readers hear the new count */}
          {(q || show !== "all") && (
            <p aria-live="polite" className="mr-auto text-sm text-slate-600">
              {count ?? 0} match{count === 1 ? "" : "es"}
            </p>
          )}
          {/* right group: the Hide/Show IDs button sits next to the filter tabs */}
          <div className="flex flex-wrap items-center gap-2">
          {/* P2: Hide/Show IDs. Hides the whole ID column (and the ID on the cards), e.g. when a customer can see the screen.
              aria-pressed tells screen readers whether the IDs are hidden right now */}
          <Link
            href={idsHref}
            scroll={false}
            aria-pressed={hideIds}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
          >
            <EyeIcon off={!hideIds} />
            {hideIds ? "Show IDs" : "Hide IDs"}
          </Link>
          {/* U4: filter tabs with counts. "All" clears the filter */}
          <FilterTabs
            current={show}
            tabs={[
              { label: "All", value: "all", href: tabHref("all") },
              { label: "Blacklisted", value: "blacklisted", href: tabHref("blacklisted"), count: totalBlacklisted ?? 0 },
              { label: "AML flagged", value: "aml", href: tabHref("aml"), count: totalAml ?? 0 },
            ]}
          />
          {/* end of the right group */}
          </div>
        </div>
        {customers && customers.length > 0 ? (
          <>
            {/* C11: CARDS on phones, tablets and big zoom (below 1100px wide). One card per customer instead of a wide table,
                so the score and flags (Blacklisted, History warning) are visible without swiping.
                R6: was phones only; at 150% zoom the 8-column table didn't fit and got cut off */}
            <ul className="divide-y divide-slate-100 min-[1100px]:hidden">
              {customers.map((c) => {
                const score = scores.get(c.id); // this customer's score and warnings
                return (
                  <li key={c.id}>
                    {/* the whole card opens the profile; blacklisted = light red background AND the word "Blacklisted" */}
                    <Link href={`/dashboard/customers/${c.id}`} className={cx("block px-4 py-3 hover:bg-slate-50", c.is_blacklisted && "bg-red-50/70")}>
                      {/* line 1: name on the left, score on the right */}
                      <span className="flex items-start justify-between gap-3">
                        <span className="font-medium text-slate-900">{c.full_name}</span>
                        <ScoreBadge score={score?.score ?? null} tier={score?.tier ?? null} />
                      </span>
                      {/* line 2: phone, and ID type + masked ID (U5) unless IDs are hidden (P2). break-all only matters for a junk long number.
                          No eye button here: the whole card is a link, and full IDs are on the profile */}
                      <span className="mt-0.5 block break-all text-sm text-slate-600">
                        {c.contact_number}
                        {!hideIds && (
                          <>
                            {" "}
                            · {c.id_type} <span className="font-mono text-xs">{maskId(c.id_number)}</span>
                          </>
                        )}
                      </span>
                      {/* line 3: flags, only if there are any */}
                      {(c.is_blacklisted || score?.hasWarnings || c.aml_status === "flagged") && (
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          {c.is_blacklisted && <Badge tone="danger">Blacklisted</Badge>}
                          {score?.hasWarnings && <Badge tone="warning">History warning</Badge>}
                          {c.aml_status === "flagged" && <Badge tone="warning">AML flagged</Badge>}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* COMPUTERS (1100px and wider): the full table */}
            <div className="hidden min-[1100px]:block">
            {/* U3: the table is never taller than the screen allows (screen height minus the header, search and page buttons),
                so the page buttons stay visible; if 10 rows don't fit, the rows scroll inside and the headings stay on top.
                max(16rem, ...) = never smaller than 16rem, even at big zoom (then the page scrolls instead).
                relative = keeps the hidden screen-reader text inside this box so it can't stretch the page */}
            {/* T1: darker column headings for this table only: slate-700 (#334155) text on slate-100 (#F1F5F9),
                about 9.5:1 contrast (was slate-500 on slate-50, about 4.6:1). Still 12px, semibold (600; [&_th] stops the browser making headings bold), uppercase, so customer
                names (14px, darker) stay the most prominent text. [&_thead]: = applies to the heading row inside this table */}
            <Table
              minWidth="720px"
              className="relative max-h-[max(16rem,calc(100dvh-24rem))] overflow-y-auto [&_thead]:bg-slate-100 [&_thead]:text-slate-700 [&_th]:font-semibold"
            >
              {/* sticky = the column headings stay visible while the rows scroll */}
              <THead sticky>
                <SortTH label="Name" column="name" current={sort} dir={dir} basePath="/dashboard/customers" params={listParams} />
                <TH>Contact</TH>
                {/* P2: no ID column at all when IDs are hidden; the other columns take the space */}
                {!hideIds && <TH>ID on file</TH>}
                {/* U9: own AML column only on wide screens (2xl = 1536px+); on smaller ones "AML flagged" shows in Flags */}
                <TH className="hidden whitespace-nowrap 2xl:table-cell">
                  {/* R2: heading + "i" button */}
                  <span className="inline-flex items-center gap-1">
                    AML check <InfoTip label="AML check">{AML_HELP}</InfoTip>
                  </span>
                </TH>
                <TH>
                  <span className="inline-flex items-center gap-1">
                    Score <InfoTip label="Score">{SCORE_HELP}</InfoTip>
                  </span>
                </TH>
                <TH>
                  {/* R1: "Compliance" on smaller screens (AML + flags together), "Flags" from 1536px (AML has its own column) */}
                  <span className="inline-flex items-center gap-1">
                    <span className="2xl:hidden">Compliance</span>
                    <span className="hidden 2xl:inline">Flags</span>
                    <InfoTip label="Flags and Compliance">{FLAGS_HELP}</InfoTip>
                  </span>
                </TH>
                <SortTH label="Registered" column="registered" current={sort} dir={dir} basePath="/dashboard/customers" params={listParams} />
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </THead>
              <TBody>
                {customers.map((c) => (
                  <TR key={c.id} highlight={c.is_blacklisted ? "danger" : undefined}>
                    {/* U9: min-w = names wrap at most onto 2 lines on smaller screens */}
                    <TD className="min-w-[9rem] font-medium">
                      {/* C7: the name is also a link to the profile, so it can always be opened */}
                      {/* P7: looks clickable: navy + underline on hover, a clear outline when reached with Tab */}
                      <Link
                        href={`/dashboard/customers/${c.id}`}
                        className="rounded-sm underline-offset-2 hover:text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
                      >
                        {c.full_name}
                      </Link>
                    </TD>
                    {/* U6: the phone number stays on one line; a junk extra-long number ends with "..." (hover shows it all) */}
                    <TD className="text-slate-600">
                      <span className="block max-w-[9.5rem] truncate whitespace-nowrap tabular-nums" title={c.contact_number}>
                        {c.contact_number}
                      </span>
                    </TD>
                    {/* U5: ID type + only the last 4 characters.
                        U9: type above the number on smaller screens, side by side from 1536px */}
                    {!hideIds && (
                      <TD className="whitespace-nowrap text-slate-600">
                        <span className="block text-xs text-slate-500 2xl:inline">{c.id_type}</span>{" "}
                        {/* P3: masked number + eye button for allowed roles. Only the masked text is sent to the browser */}
                        <IdReveal customerId={c.id} masked={maskId(c.id_number)} ending={idEnding(c.id_number)} canReveal={canReveal} />
                      </TD>
                    )}
                    {/* U7: hover the badge to see when the check ran (wide screens only, see U9) */}
                    <TD className="hidden 2xl:table-cell">
                      <span title={c.aml_checked_at ? `Watchlist check at registration, ${formatDate(c.aml_checked_at)}` : "Watchlist check at registration"}>
                        <StatusBadge status={c.aml_status} label={c.aml_status === "flagged" ? "Flagged" : "Clear"} />
                      </span>
                    </TD>
                    <TD>
                      <ScoreBadge score={scores.get(c.id)?.score ?? null} tier={scores.get(c.id)?.tier ?? null} />
                    </TD>
                    <TD>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {/* R1: on smaller screens (Compliance column) the AML result is ALWAYS shown first, clear or flagged,
                            in words, so it's never hidden. From 1536px it has its own column, so this part hides. */}
                        <span className="2xl:hidden">
                          {c.aml_status === "flagged" ? <Badge tone="warning">AML flagged</Badge> : <span className="text-slate-600">AML clear</span>}
                        </span>
                        {/* blacklist and history warnings, every screen size */}
                        {c.is_blacklisted && <Badge tone="danger">Blacklisted</Badge>}
                        {scores.get(c.id)?.hasWarnings && <Badge tone="warning">History warning</Badge>}
                        {/* U8: "None" on wide screens when there are no flags (on smaller screens "AML clear" already fills the cell) */}
                        {!c.is_blacklisted && !scores.get(c.id)?.hasWarnings && <span className="hidden text-slate-500 2xl:inline">None</span>}
                      </span>
                    </TD>
                    {/* C7: whitespace-nowrap keeps the date on one line ("Oct 9, 2026") */}
                    <TD className="whitespace-nowrap text-slate-600">{formatDate(c.created_at)}</TD>
                    <ActionsCell>
                      {/* U9: "View" on smaller screens (screen readers still hear "View customer"), full words from 1536px */}
                      <ViewButton href={`/dashboard/customers/${c.id}`}>
                        View<span className="sr-only 2xl:not-sr-only"> customer</span>
                      </ViewButton>
                    </ActionsCell>
                  </TR>
                ))}
              </TBody>
            </Table>
            {/* end of the computer-only table */}
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/dashboard/customers" params={listParams} />
          </>
        ) : (
          <EmptyState
            icon="users"
            // R4: a message that says exactly which list is empty
            title={
              q
                ? "No customers match your search"
                : show === "blacklisted"
                  ? "No blacklisted customers"
                  : show === "aml"
                    ? "No AML-flagged customers"
                    : "No customers yet"
            }
            description={
              q
                ? show !== "all"
                  ? "Check the spelling, or choose All to search every customer."
                  : "Check the spelling, or search by mobile or ID number instead."
                : show !== "all"
                  ? "Choose All to see every customer."
                  : canRegister
                    ? "Use Register customer at the top to add the first one."
                    : "An Operator or Admin registers customers before their first appraisal."
            }
          />
        )}
        {/* U7: short explanation of the columns. Closed by default so it takes one line */}
        <details className="border-t border-slate-200 px-4 py-2.5 text-sm text-slate-600">
          <summary className="cursor-pointer font-medium text-navy-700 hover:underline">What do AML check, Score, Flags and Compliance mean?</summary>
          <dl className="mt-2 grid gap-2 sm:grid-cols-3">
            <div>
              <dt className="font-semibold text-slate-800">AML check</dt>
              <dd>{AML_HELP}</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Score (0 to 100)</dt>
              <dd>{SCORE_HELP}</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Flags and ID</dt>
              <dd>
                {FLAGS_HELP} ID numbers show only the last 4 characters. Admin, Operator and Cashier can click the eye to see one
                full ID; it hides again after 30 seconds. Hide IDs removes the ID column, e.g. when a customer can see the screen.
              </dd>
            </div>
          </dl>
        </details>
      </Card>
    </div>
  );
}