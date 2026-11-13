import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { formatDate, formatDateTime, manilaToday } from "@/lib/format";
import { dateParam, reportData } from "@/lib/reports/report-utils";
import type { Json } from "@/lib/supabase/database.types";
import { Badge, Card, EmptyState, Table, TBody, TD, TH, THead, TR, buttonClasses, cx, pageParam } from "@/components/ui";
import { Icon } from "@/components/icons";
import { allFields, maskSensitive } from "@/lib/audit/changes"; // AT2: every field for the popup; AT5: second masking layer
import {
  ACTION_TONE,
  ACTION_WORD,
  RECORD_TYPES,
  adminEdit,
  detailsLabel,
  eventReason,
  eventSummary,
  eventTitle,
  recordName,
  recordRef,
  refIds,
  type AuditAction,
  type RefLookups,
} from "@/lib/audit/events"; // AT7: WHAT / WHICH / WHY in plain words
import { AuditDataButton } from "./audit-data-dialog"; // AT2: the popup with one line per field
import { AuditPagination } from "./audit-pagination"; // AT8: page numbers and Go to page
import { PrintScope } from "./report-parts"; // RP11: says on paper when only part of the list is printed

// AT8 (Nov 13): 10 entries per page (was 50), so the page stays short and an entry is found by filtering, not scrolling.
const PAGE_SIZE = 10;
const ACTIONS: AuditAction[] = ["INSERT", "UPDATE", "DELETE", "VIEW"];
const ACTIVITY = [
  { value: "", label: "All activity", count: "all" },
  { value: "changes", label: "Changes only", count: "changes" },
  { value: "views", label: "Views", count: "views" },
] as const;

// one entry as audit_log_page sends it (ID numbers already masked by the database)
type AuditEntry = { id: string; table_name: string; record_id: string; action: string; actor: string | null; created_at: string; changed_data: Json | null; old_data: Json | null };
type FindKind = "id" | "ticket" | "receipt" | "customer" | "appraisal" | "batch";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// AT3 (Nov 12) + AT9 (Nov 13): what the search box understands: a record ID, a pawn ticket (PT-...), a receipt
// (RC-...), a customer number (C-0012), an appraisal number (A-0036) or an auction batch (AB-0007).
function recordSearch(q: string): { kind: FindKind; value: string; label: string } | null {
  const s = q.trim();
  if (!s) return null;
  if (UUID_RE.test(s)) return { kind: "id", value: s.toLowerCase(), label: "this record ID" };
  if (/^PT-/i.test(s)) return { kind: "ticket", value: s.toUpperCase(), label: s.toUpperCase() };
  if (/^RC-/i.test(s)) return { kind: "receipt", value: s.toUpperCase(), label: s.toUpperCase() };
  const ab = /^ab[\s-]?(\d{1,9})$/i.exec(s);
  if (ab) return { kind: "batch", value: String(Number(ab[1])), label: `AB-${ab[1].padStart(4, "0")}` };
  const c = /^c[\s-]?(\d{1,9})$/i.exec(s);
  if (c) return { kind: "customer", value: String(Number(c[1])), label: `C-${c[1].padStart(4, "0")}` };
  const a = /^a[\s-]?(\d{1,9})$/i.exec(s);
  if (a) return { kind: "appraisal", value: String(Number(a[1])), label: `A-${a[1].padStart(4, "0")}` };
  return null;
}

// AT9: what a linked search shows, in words
const LINKED: Partial<Record<FindKind, (l: string) => string>> = {
  ticket: (l) => `Loan ${l} and everything linked to it: its payments, renewals, cash entries, reminders and flags.`,
  customer: (l) => `Customer ${l} and everything linked to them: ID views, appraisals, loans and flags.`,
  appraisal: (l) => `Appraisal ${l}, its inventory item and its loan.`,
  batch: (l) => `Auction batch ${l} and its items.`,
};

export async function AuditTrail({ params }: { params: Record<string, string | undefined> }) {
  await requireRole(["admin"]);
  const table = RECORD_TYPES.some(([t]) => t === params.table) ? params.table : undefined;
  const action = ACTIONS.find((a) => a === params.action);
  const activity = params.activity === "changes" || params.activity === "views" ? params.activity : undefined;
  const page = pageParam(params.page);
  const today = manilaToday();
  const from = dateParam(params.from);
  const to = dateParam(params.to);
  const badRange = Boolean(from && to && from > to);
  const q = (params.q ?? "").trim().slice(0, 80);
  const find = recordSearch(q);

  const supabase = await createClient();
  const { data: staff } = await supabase.from("profiles").select("id, full_name").order("full_name");
  const names = new Map((staff ?? []).map((p) => [p.id, p.full_name]));
  // AT3: "Performed by": one employee, or "System / service" (no signed-in person, e.g. the nightly default check)
  const by = params.by === "system" || names.has(params.by ?? "") ? params.by : undefined;

  // AT4 (Nov 12): read only through audit_log_page (Admins only; filters, pages and masks ID numbers in the database).
  // AT8/AT9 (Nov 13, migration 0068): it also filters All activity / Changes only / Views, finds every entry linked
  // to a ticket, customer, appraisal or batch, and shows the last page when asked for a page past the end.
  const { data, error } = await supabase.rpc("audit_log_page", {
    p_table: table,
    p_action: action,
    p_by: by,
    p_from: badRange ? undefined : from, // AT3: Manila calendar days, the same boundaries as the other reports
    p_to: badRange ? undefined : to,
    p_find_kind: find?.kind,
    p_find: find?.value,
    p_page: page,
    p_size: PAGE_SIZE,
    p_kind: activity,
  });
  const result = reportData<{ total: number; page: number; counts: { all: number; changes: number; views: number }; rows: AuditEntry[] }>({ data, error });
  const count = Number(result.total);
  const shownPage = Number(result.page) || 1; // the page the database actually sent (a page past the end -> the last page)
  // AT5: the database already masked ID numbers; this is the second layer
  const entries = (result.rows ?? []).map((e) => ({ ...e, changed_data: maskSensitive(e.changed_data), old_data: maskSensitive(e.old_data) }));

  // AT7: the readable references (PT- / C- / A- / AB-) of the linked records on this page: a few small reads of
  // only the number and name columns (never ID numbers), for at most 10 entries
  const lk = await lookups(supabase, entries);

  const filtered = Boolean(table || action || by || from || to || q || activity);
  const keep = { tab: "audit", table, action, by, from: badRange ? undefined : from, to: badRange ? undefined : to, q: q || undefined };
  const listParams = { ...keep, activity };
  const activityHref = (v: string) => {
    const p = new URLSearchParams(Object.entries({ ...keep, activity: v || undefined }).filter(([, x]) => x) as [string, string][]);
    return `/dashboard/reports?${p.toString()}`;
  };
  const field = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20";

  return (
    <Card padded={false}>
      {/* AT8: what this is, how many events there are, and that it can't be changed */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="font-semibold text-slate-900">Activity history</h2>
          <p className="text-sm text-slate-600">
            {Number(result.counts?.all ?? 0).toLocaleString("en-PH")} recorded event{result.counts?.all === 1 ? "" : "s"}
            {from || to ? ` · ${from ? formatDate(from) : "start"} – ${to ? formatDate(to) : "today"}` : ""}. Who did what, when, why and to which record.
          </p>
        </div>
        <p className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
          <Icon name="shield" className="h-3.5 w-3.5" /> Read-only · ID numbers show the last 4 only
        </p>
      </div>

      {/* AT8: the quick switch. Every event stays in the history; this only chooses what is listed */}
      <nav aria-label="Activity" className="flex flex-wrap gap-1.5 border-b border-slate-200 px-4 py-2.5 print:hidden">
        {ACTIVITY.map((a) => {
          const on = (activity ?? "") === a.value;
          return (
            <Link
              key={a.label}
              href={activityHref(a.value)}
              aria-current={on ? "page" : undefined}
              className={cx(
                "rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500",
                on ? "bg-navy-800 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              {a.label} <span className={on ? "text-navy-100" : "text-slate-500"}>({Number(result.counts?.[a.count] ?? 0).toLocaleString("en-PH")})</span>
            </Link>
          );
        })}
      </nav>

      {/* AT8: the filters, aligned on one grid: search on top, the five filters in one row on a laptop, the buttons
          at the end. All in the address, so Back, the page links and Go to page keep them */}
      <form action="/dashboard/reports" className="space-y-3 border-b border-slate-200 p-4 print:hidden">
        <input type="hidden" name="tab" value="audit" />
        {activity && <input type="hidden" name="activity" value={activity} />}
        <div>
          <label htmlFor="q" className="block text-xs font-medium text-slate-600">
            Find a record
          </label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder="PT-… ticket, RC-… receipt, C-0012, A-0036, AB-0007 or a record ID" className={field} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label htmlFor="table" className="block text-xs font-medium text-slate-600">
              Record type
            </label>
            <select id="table" name="table" defaultValue={table ?? ""} className={field}>
              <option value="">All records</option>
              {RECORD_TYPES.map(([t, , list]) => (
                <option key={t} value={t}>
                  {list}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="action" className="block text-xs font-medium text-slate-600">
              Action
            </label>
            <select id="action" name="action" defaultValue={action ?? ""} className={field}>
              <option value="">Any</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {ACTION_WORD[a]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="by" className="block text-xs font-medium text-slate-600">
              Performed by
            </label>
            <select id="by" name="by" defaultValue={by ?? ""} className={field}>
              <option value="">Anyone</option>
              <option value="system">System / service</option>
              {(staff ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="from" className="block text-xs font-medium text-slate-600">
              From date
            </label>
            <input id="from" name="from" type="date" defaultValue={from ?? ""} max={today} className={field} />
          </div>
          <div>
            <label htmlFor="to" className="block text-xs font-medium text-slate-600">
              To date
            </label>
            <input id="to" name="to" type="date" defaultValue={to ?? ""} max={today} className={field} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {filtered && (
            <Link href="/dashboard/reports?tab=audit" className={buttonClasses("ghost")}>
              Clear filters
            </Link>
          )}
          <button type="submit" className={buttonClasses("primary")}>
            Apply filters
          </button>
        </div>
      </form>

      {(badRange || (q && !find)) && (
        <p className="border-b border-slate-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="status">
          {badRange && "The From date is after the To date, so the dates were not used. "}
          {q && !find && "Find a record understands a pawn ticket (PT-…), a receipt (RC-…), C-0012, A-0036, AB-0007 or a record ID, so the search was not used."}
        </p>
      )}
      {/* AT9: a linked search says what it includes */}
      {find && LINKED[find.kind] && (
        <p className="border-b border-slate-200 bg-navy-50 px-4 py-2 text-sm text-navy-900" role="status">
          {LINKED[find.kind]!(find.label)}
        </p>
      )}

      {entries.length > 0 ? (
        <>
          <PrintScope page={shownPage} size={PAGE_SIZE} total={count} shown={entries.length} all={false} totalRow={false} advice="Narrow the filters (dates, record type, Find a record) or print each page." />
          <Table minWidth="880px">
            <THead>
              <TH>When</TH>
              <TH>Event</TH>
              <TH>Record</TH>
              <TH>Performed by</TH>
              <TH>What changed</TH>
            </THead>
            <TBody>
              {entries.map((e) => {
                const act = (ACTIONS.includes(e.action as AuditAction) ? e.action : "UPDATE") as AuditAction;
                const ref = recordRef(e, lk);
                const who = e.actor ? (names.get(e.actor) ?? "Unknown user") : "System / service";
                const reason = eventReason(e);
                const title = eventTitle(e);
                const edit = adminEdit(e);
                return (
                  <TR key={e.id}>
                    {/* WHEN */}
                    <TD className="whitespace-nowrap align-top text-slate-600">{formatDateTime(e.created_at)}</TD>
                    {/* WHAT: one title and one badge (AT7: Created / Updated / Deleted / Viewed, the same words everywhere) */}
                    <TD className="align-top">
                      <span className="block font-medium text-slate-900">{title}</span>
                      <span className="mt-1 inline-block">
                        <Badge tone={ACTION_TONE[act]}>{ACTION_WORD[act]}</Badge>
                      </span>
                    </TD>
                    {/* WHICH: the reference people use; the record ID is in the popup */}
                    <TD className="align-top">
                      {ref.main ? (
                        <span className={cx("block text-slate-900", /^(PT|RC)-/.test(ref.main) ? "break-all font-mono text-xs" : "font-medium")}>{ref.main}</span>
                      ) : (
                        <span className="block font-mono text-xs text-slate-500">ID …{String(e.record_id).slice(-6)}</span>
                      )}
                      <span className="block max-w-[16rem] truncate text-xs text-slate-600" title={ref.sub || undefined}>
                        {[recordName(e.table_name), ref.sub].filter(Boolean).join(" · ")}
                      </span>
                    </TD>
                    {/* WHO */}
                    <TD className={cx("align-top", !e.actor && "text-slate-500")}>{who}</TD>
                    {/* WHAT CHANGED and WHY, then the full details */}
                    <TD className="align-top">
                      <p className="max-w-md text-sm text-slate-800">{eventSummary(e, names)}</p>
                      {reason && <p className="mt-0.5 max-w-md text-xs font-medium text-amber-900">Reason: {reason}</p>}
                      <div className="mt-1.5">
                        <AuditDataButton
                          label={detailsLabel(e)}
                          title={title}
                          subtitle={`${formatDateTime(e.created_at)} · ${who} · ${ACTION_WORD[act]}`}
                          record={{ ref: [ref.main, ref.sub].filter(Boolean).join(" · "), id: e.record_id }}
                          reason={reason || undefined}
                          rows={edit ? allFields(edit.before, edit.after, names) : allFields(e.action === "UPDATE" ? e.old_data : null, e.changed_data ?? e.old_data, names)}
                          raw={{ before: e.action === "UPDATE" ? (e.old_data ?? null) : null, after: e.changed_data }}
                        />
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <AuditPagination page={shownPage} pageSize={PAGE_SIZE} total={count} params={listParams} />
        </>
      ) : (
        <EmptyState
          icon="log"
          title={filtered ? "No audit entries match these filters" : "No audit entries yet"}
          description={filtered ? "Try a wider date range, All records, or Clear filters." : undefined}
        />
      )}
    </Card>
  );
}

// AT7: reads the numbers and names of the records linked to this page's entries. Only these columns are read
// (never customers.id_number), with the Admin's own login, so the normal access rules apply.
async function lookups(supabase: Awaited<ReturnType<typeof createClient>>, entries: AuditEntry[]): Promise<RefLookups> {
  const ids = refIds(entries);
  const none = Promise.resolve({ data: [] as never[] });
  const [loans, items, batches] = await Promise.all([
    ids.loans.length ? supabase.from("loans").select("id, ticket_number, customer_id").in("id", ids.loans) : none,
    ids.items.length ? supabase.from("inventory_items").select("id, appraisal_item_id").in("id", ids.items) : none,
    ids.batches.length ? supabase.from("auction_batches").select("id, batch_no").in("id", ids.batches) : none,
  ]);
  // the customers and appraisals named directly, plus those of the loans and items found above
  const customerIds = [...new Set([...ids.customers, ...(loans.data ?? []).map((l) => l.customer_id).filter((x): x is string => !!x)])];
  const appraisalIds = [...new Set([...ids.appraisals, ...(items.data ?? []).map((i) => i.appraisal_item_id).filter((x): x is string => !!x)])];
  const [customers, appraisals] = await Promise.all([
    customerIds.length ? supabase.from("customers").select("id, customer_no, full_name").in("id", customerIds) : none,
    appraisalIds.length ? supabase.from("appraisal_items").select("id, appraisal_no").in("id", appraisalIds) : none,
  ]);
  return {
    loans: new Map((loans.data ?? []).map((l) => [l.id, { ticket_number: l.ticket_number, customer_id: l.customer_id }])),
    customers: new Map((customers.data ?? []).map((c) => [c.id, { customer_no: c.customer_no, full_name: c.full_name }])),
    appraisals: new Map((appraisals.data ?? []).map((a) => [a.id, { appraisal_no: a.appraisal_no }])),
    items: new Map((items.data ?? []).map((i) => [i.id, { appraisal_item_id: i.appraisal_item_id }])),
    batches: new Map((batches.data ?? []).map((b) => [b.id, { batch_no: b.batch_no }])),
  };
}
