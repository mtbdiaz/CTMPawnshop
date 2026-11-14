import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { MOVEMENT_LABEL, entryTypeLabel, hasFilters, ledgerFilters, movementOf, shortDescription, type LedgerPage, type LedgerRow } from "@/lib/finance/ledger"; // CL1: the words and the address filters
import { formatDate, formatDateTime, formatPeso } from "@/lib/format";
import { Alert, Badge, Card, EmptyState, PageHeader, Pagination, StatCard, Table, TBody, TD, TH, THead, TR, pageParam } from "@/components/ui";
import { RecordCashEntryButton } from "./cash-entry-form";
import { EntryDetails } from "./entry-details";
import { LedgerFiltersBar } from "./ledger-filters";

export const metadata = { title: "Cash & ledger" };

const PAGE_SIZE = 10; // rows per page, same as the other lists (was 30)
const BASE = "/dashboard/finance";

// PB-28 / PB-29 / PB-30 + CL1 (Nov 12, migration 0055).
// Before: the page loaded the WHOLE ledger (2,709 rows) on every visit, added it up in JavaScript, showed 30 rows
// with no search, and kept the manual-entry form open at the top.
// Now: the database returns today's totals, the balance and ONE page of 10 entries (with search and filters), all
// added up with exact decimals. "Record cash entry" is a button that opens a popup with a review step.
// Nothing about how money is recorded changed: loans, payments, renewals and auction sales still write their own
// entries; a manual entry is still only an Expense or a Revenue.
export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireRole(["operator", "cashier", "admin"]);
  const isAdmin = user.profile.role === "admin";
  const sp = await searchParams;
  const page = pageParam(sp.page);
  const f = ledgerFilters(sp); // the search and filters from the address, cleaned
  if (!isAdmin) f.check = false; // "?check=1" (the needs-checking list) is for an Admin; for others it is ignored
  const filtered = hasFilters(f);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cash_ledger_page", {
    p_q: f.q || undefined,
    p_type: f.type || undefined,
    p_flow: f.flow || undefined,
    p_source: f.source || undefined,
    p_from: f.from || undefined,
    p_to: f.to || undefined,
    p_check: f.check, // the "needs checking" list (only offered to an Admin, see above)
    p_page: page,
    p_size: PAGE_SIZE,
  });
  if (error) throw error; // shows the app's error page instead of made-up numbers
  const ledger = data as unknown as LedgerPage;
  const s = ledger.summary;
  const net = Number(s.today_in) - Number(s.today_out); // both come from the database as exact amounts
  const today = formatDate(s.today); // the Manila date the "today" numbers are for

  // the address of a page of the same filtered list
  const params = { q: f.q || undefined, type: f.type || undefined, flow: f.flow || undefined, source: f.source || undefined, from: f.from || undefined, to: f.to || undefined, check: f.check ? "1" : undefined };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cash & ledger"
        description="Loans, payments, renewals and auction sales are recorded here automatically. Other expenses and income are recorded by hand."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Cash & ledger" }]}
        actions={<RecordCashEntryButton recordedBy={`${user.profile.full_name} (${user.profile.role})`} locked={s.changes_locked} />}
      />

      {/* the four numbers. "Today" is the shop's day (Manila time). The balance is CALCULATED from the entries;
          it is not a count of the cash in the drawer, and the card says so */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Cash in today" value={`${Number(s.today_in) > 0 ? "+" : ""}${formatPeso(Number(s.today_in))}`} hint={`${today} · cash received`} />
        <StatCard label="Cash out today" value={`${Number(s.today_out) > 0 ? "−" : ""}${formatPeso(Number(s.today_out))}`} hint={`${today} · cash paid out`} />
        <StatCard label="Net today" value={`${net < 0 ? "−" : net > 0 ? "+" : ""}${formatPeso(Math.abs(net))}`} hint="Cash in minus cash out" tone={net < 0 ? "warning" : "default"} />
        <StatCard label="Ledger balance" value={formatPeso(Number(s.balance))} hint={
            <>
              {/* CL2: the warning first, right under the amount */}
              {s.under_review && <span className="block font-medium text-amber-800">Includes entries under review.</span>}
              Calculated from {s.entries.toLocaleString("en-PH")} entries. No cash drawer count is available.
            </>
          }
        />
      </div>

      {/* Admin only: the auction-sale entries that have no sale record. They ARE in the balance; nothing is hidden or removed */}
      {isAdmin && (s.check_count ?? 0) > 0 && (
        // CL2: one short line each for the fact and the amount, and a button to the list
        <Alert tone="warning" title={`${s.check_count} auction entries have no matching sale record`}>
          <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span>{formatPeso(Number(s.check_sum))} is included in the ledger balance. Nothing was changed; an Admin and the developer decide what these entries are.</span>
            <Link href={f.check ? BASE : `${BASE}?check=1`} className="whitespace-nowrap rounded-md border border-amber-400 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">
              {f.check ? "Show all entries" : `View ${s.check_count} entries`}
            </Link>
          </span>
        </Alert>
      )}

      {/* FC1: Operator and Cashier are told the same fact, without the count or the amount (those are for an Admin) */}
      {!isAdmin && s.under_review && (
        <Alert tone="info" title="The ledger balance includes entries that are under review">
          Some auction-sale entries have no matching sale record yet. They are counted in the balance until an Admin decides what they are. In the list they are marked
          &ldquo;No sale record&rdquo;.
        </Alert>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3">
          <h2 className="text-sm font-semibold text-slate-900">Transactions</h2>
          <p aria-live="polite" className="text-sm text-slate-600">
            {filtered ? (
              <>
                <span className="font-medium text-slate-900">{ledger.total.toLocaleString("en-PH")}</span> match{ledger.total === 1 ? "" : "es"} · cash in{" "}
                <span className="tabular-nums">{formatPeso(Number(ledger.sum_in))}</span> · cash out <span className="tabular-nums">{formatPeso(Number(ledger.sum_out))}</span>
              </>
            ) : (
              "Newest first. Balance is the ledger balance after each entry."
            )}
          </p>
        </div>
        <LedgerFiltersBar key={JSON.stringify(f)} filters={f} />
        {/* CL2: so nobody reads a filtered list's balance as a subtotal of the rows shown */}
        {filtered && <p className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">Filters change which entries are shown. Balances use the full ledger.</p>}

        {ledger.rows.length > 0 ? (
          <>
            {/* wide screens (from 1280px): a table. Narrower than that the seven columns don't fit without scrolling
                sideways, so the same entries are shown as cards below */}
            <div className="hidden xl:block">
              <Table minWidth="720px">
                <THead>
                  <TH>Date</TH>
                  <TH>Type</TH>
                  <TH>Description</TH>
                  <TH align="right">Cash in</TH>
                  <TH align="right">Cash out</TH>
                  <TH align="right">Balance after entry</TH>
                  <TH>
                    <span className="sr-only">Details</span>
                  </TH>
                </THead>
                <TBody>
                  {ledger.rows.map((row) => {
                    const move = movementOf(row);
                    return (
                      <TR key={row.id}>
                        <TD className="whitespace-nowrap text-slate-600">{formatDateTime(row.created_at)}</TD>
                        <TD>
                          <span className="block whitespace-nowrap">{entryTypeLabel(row.entry_type)}</span>
                          <RowBadges row={row} />
                        </TD>
                        <TD className="max-w-xs">
                          <RowText row={row} />
                        </TD>
                        {/* the sign and the column say the direction; the color only supports it */}
                        <TD align="right" className="whitespace-nowrap tabular-nums text-emerald-800">
                          {move === "in" ? `+${formatPeso(Number(row.amount))}` : ""}
                        </TD>
                        <TD align="right" className="whitespace-nowrap tabular-nums text-red-700">
                          {move === "out" ? `−${formatPeso(Number(row.amount))}` : ""}
                          {move === "noncash" && <span className="text-slate-600">No cash movement</span>}
                        </TD>
                        <TD align="right" className="whitespace-nowrap font-medium tabular-nums">
                          {formatPeso(Number(row.balance))}
                        </TD>
                        <TD align="right">
                          <EntryDetails row={row} isAdmin={isAdmin} locked={s.changes_locked} />
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>

            {/* phones, tablets and zoomed-in laptops: the same entries as cards, so nothing scrolls sideways */}
            <ul className="divide-y divide-slate-100 xl:hidden">
              {ledger.rows.map((row) => {
                const move = movementOf(row);
                return (
                  <li key={row.id} className="space-y-1 px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block font-medium text-slate-900">{entryTypeLabel(row.entry_type)}</span>
                        <span className="block text-xs text-slate-600">{formatDateTime(row.created_at)}</span>
                      </span>
                      <span className="text-right">
                        <span className={move === "in" ? "block font-semibold tabular-nums text-emerald-800" : move === "out" ? "block font-semibold tabular-nums text-red-700" : "block text-slate-700"}>
                          {move === "in" ? `Cash in +${formatPeso(Number(row.amount))}` : move === "out" ? `Cash out −${formatPeso(Number(row.amount))}` : MOVEMENT_LABEL.noncash}
                        </span>
                        <span className="block text-xs tabular-nums text-slate-600">Balance after entry {formatPeso(Number(row.balance))}</span>
                      </span>
                    </div>
                    <RowText row={row} />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <RowBadges row={row} />
                      <EntryDetails row={row} isAdmin={isAdmin} locked={s.changes_locked} />
                    </div>
                  </li>
                );
              })}
            </ul>

            <Pagination page={ledger.page} pageSize={PAGE_SIZE} total={ledger.total} basePath={BASE} params={params} />
          </>
        ) : filtered ? (
          <EmptyState
            title="No entry matches"
            description="Try a ticket number, a receipt number, a word from the description or the customer's name, or widen the dates."
            action={
              <Link href={BASE} className="text-sm font-medium text-navy-700 hover:underline">
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState title="No cash entries yet." description="Entries appear as loans are issued and paid." />
        )}

        {/* FC1: archiving takes an entry out of the list and the totals, so the page says how many are archived */}
        {s.archived > 0 && (
          <p className="border-t border-slate-200 px-4 py-2 text-sm text-slate-600">
            {s.archived} archived {s.archived === 1 ? "entry is" : "entries are"} not listed and not counted in these totals.{" "}
            {isAdmin ? (
              <Link href="/dashboard/archive" className="font-medium text-navy-700 hover:underline">
                See them in Archive
              </Link>
            ) : (
              "An Admin can see them in Archive."
            )}
          </p>
        )}

        {/* what the numbers mean, closed by default (the same fold-out box as Loans and Customers) */}
        <details className="border-t border-slate-200 px-4 py-2.5 text-sm text-slate-600">
          <summary className="cursor-pointer rounded font-medium text-navy-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500">
            What do Cash in, Cash out, Net today and Ledger balance mean?
          </summary>
          <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="font-semibold text-slate-800">Cash in today</dt>
              {/* LC7 (Nov 14): + "and liquidated damages" (a renewal also collects them since 0073). Before: "renewal interest" */}
              <dd>Every cash entry that came in since 12:00 midnight today (Manila time): payments, renewal interest and liquidated damages, auction sales, other revenue.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Cash out today</dt>
              <dd>Every cash entry that went out today: loans released and expenses.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Net today</dt>
              <dd>Cash in today minus cash out today. A minus sign means more went out than came in.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Ledger balance</dt>
              <dd>All cash in minus all cash out, from the first entry to now. It is calculated from the entries. It is not a count of the money in the drawer.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Balance (in the list)</dt>
              <dd>The ledger balance right after that entry. It is the same number on any page and inside any search.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Non-cash (capitalization)</dt>
              <dd>Unpaid interest added to a loan&apos;s principal. No money moved, so it is listed but not in any total or balance.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Recorded by the system</dt>
              <dd>Made by a loan, a payment, a renewal or an auction sale. It is corrected from that loan, which adds an Adjustment entry; the original stays.</dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-800">Manual entry</dt>
              <dd>
                An Expense or Revenue typed in with Record cash entry.{" "}
                {s.changes_locked
                  ? "A saved entry can't be corrected, archived or restored in the app right now, by any role."
                  : "Only an Admin can correct or archive it, with a written reason that is kept in the audit log."}
              </dd>
            </div>
          </dl>
          {/* LK1: the temporary rule, in plain words, for everyone who can open the ledger */}
          {s.changes_locked && (
            <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
              <span className="font-semibold text-slate-900">Corrections are switched off for now.</span> Correcting, archiving and restoring ledger entries is turned off
              for every role until a proper reversal workflow is approved. A mistake in a manual entry can&apos;t be fixed in the app yet: tell the Admin and write it down.
              Don&apos;t record a second entry to balance it. Recording new entries works as usual.
            </p>
          )}
          <p className="mt-3">
            <span className="font-semibold text-slate-800">Not in this system:</span> counting the cash in the drawer and comparing it with the ledger balance (opening float,
            counted cash, variance). Archived entries are not listed and not counted.
          </p>
        </details>
      </Card>
    </div>
  );
}

// the small labels under the type: how it was recorded, and anything that needs attention (words, not only color)
function RowBadges({ row }: { row: LedgerRow }) {
  return (
    <span className="mt-0.5 flex flex-wrap gap-1">
      {row.manual && <Badge tone="info">Manual</Badge>}
      {row.is_memo && <Badge tone="neutral">Non-cash</Badge>}
      {row.no_sale_record && <Badge tone="warning">No sale record</Badge>}
      {row.edits.length > 0 && <Badge tone="neutral">Corrected</Badge>}
    </span>
  );
}

// the description: a short sentence first, then the ticket, receipt and customer on their own small line.
// The long numbers are links or plain text that can be selected; the full description is in Details.
function RowText({ row }: { row: LedgerRow }) {
  return (
    <span className="block min-w-0">
      <span className="block break-words text-slate-900">{shortDescription(row)}</span>
      {(row.ticket_number || row.receipt_number || row.customer_name) && (
        <span className="block break-all text-xs text-slate-600">
          {row.ticket_number && row.related_loan_id && (
            <Link href={`/dashboard/loans/${row.related_loan_id}`} className="font-mono text-navy-700 underline-offset-2 hover:underline">
              {row.ticket_number}
            </Link>
          )}
          {row.receipt_number && <span className="font-mono"> · {row.receipt_number}</span>}
          {row.customer_name && <span className="break-normal"> · {row.customer_name}</span>}
        </span>
      )}
    </span>
  );
}
