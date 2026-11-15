import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { ARCHIVABLE_TABLES, ARCHIVE_LABELS, type ArchivableTable } from "@/lib/archive";
import { formatDateTime } from "@/lib/format";
import {
  archiveCountLine,
  ARCHIVE_LIST_LIMIT,
  ARCHIVE_PAGE_SIZE,
  ARCHIVE_SELECT,
  archiveFilters,
  describeArchived,
  filterArchiveRows,
  historyOnlyReason,
  isFiltered,
  pageOf,
  SYSTEM_ACTOR,
  type ArchiveRow,
} from "@/lib/archive-view";
import { Alert, Card, EmptyState, PageHeader, Pagination, pageParam, Table, TBody, TD, TH, THead, TR, buttonClasses } from "@/components/ui";
import { ViewTabs } from "@/components/view-tabs"; // D2: the shared tab row
import { ArchiveReview } from "./archive-review";

export const metadata = { title: "Archive" };

// D2: the 5 most used types are tabs; the other 6 go in the "More types" dropdown, so the row fits one line
const MAIN_TYPES: ArchivableTable[] = ["customers", "appraisal_items", "loans", "loan_payments", "inventory_items"];
const MORE_TYPES = ARCHIVABLE_TABLES.filter((t) => !MAIN_TYPES.includes(t)); // Renewals, Cash entries, Auction batches, ...

const control = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-500/20";

// Archive Phase 2B (Nov 15): Admin-only list of everything archived.
// Before: the newest 200 of one type, rows built from raw columns (database IDs and timestamps for 3 types), no counts,
// search or paging, and a Restore button on every row (even where restoring always fails or would be unsafe).
// Now: counts on every type, search + archived-when + archived-by + sort (kept in the address), 10 per page, readable
// names, and "Review" on every row: the popup shows the archive details and history and offers Restore only when the
// database allows it (migration 0085). Phones get cards.
export default async function ArchivePage({ searchParams }: { searchParams: Promise<{ type?: string; q?: string; when?: string; by?: string; sort?: string; page?: string }> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const table: ArchivableTable = (ARCHIVABLE_TABLES as readonly string[]).includes(sp.type ?? "") ? (sp.type as ArchivableTable) : "customers";
  const f = archiveFilters(sp);

  const supabase = await createClient();
  const [counts, { data, error }, { data: staff }] = await Promise.all([
    Promise.all(ARCHIVABLE_TABLES.map((t) => supabase.from(t).select("id", { count: "exact", head: true }).not("archived_at", "is", null))),
    supabase
      .from(table)
      .select(`id, archived_at, archive_reason, archived_by, ${ARCHIVE_SELECT[table]}`)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .limit(ARCHIVE_LIST_LIMIT),
    supabase.from("profiles").select("id, full_name"),
  ]);
  if (error) throw error;
  const countOf = Object.fromEntries(ARCHIVABLE_TABLES.map((t, i) => [t, counts[i].count ?? 0])) as Record<ArchivableTable, number>;
  const names = new Map((staff ?? []).map((p) => [p.id, p.full_name]));

  const all: ArchiveRow[] = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const by = (r.archived_by as string | null) ?? null;
    return {
      id: String(r.id),
      ...describeArchived(table, r),
      reason: String(r.archive_reason ?? "").trim(),
      archivedAt: String(r.archived_at),
      archivedById: by,
      archivedBy: by ? (names.get(by) ?? "A former staff member") : "System (data cleanup)",
    };
  });
  const shown = filterArchiveRows(all, f);
  const { page, rows } = pageOf(shown, pageParam(sp.page));
  const filtered = isFiltered(f);
  const historyOnly = historyOnlyReason(table);
  const label = ARCHIVE_LABELS[table];
  const people = [...new Map(all.filter((r) => r.archivedById).map((r) => [r.archivedById as string, r.archivedBy])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const hasSystem = all.some((r) => r.archivedById === null);
  const tab = (t: ArchivableTable) => ({ label: ARCHIVE_LABELS[t], value: t, href: `/dashboard/archive?type=${t}`, count: countOf[t] });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Archive"
        description="Records set aside from the normal lists. Nothing is ever deleted. Review a record to see why it was archived and whether it can be restored."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Archive" }]}
      />
      <Card padded={false}>
        <ViewTabs label="Archived record types" current={table} tabs={MAIN_TYPES.map(tab)} more={{ label: "More types", options: MORE_TYPES.map(tab) }} />

        <div className="space-y-4 px-4 py-4">
          {historyOnly && (
            <Alert tone="info" title={`${label} are kept as history`}>
              {historyOnly}
            </Alert>
          )}

          {/* search and filters: a normal form, so the address keeps the choices (Back works, links can be shared) */}
          <form action="/dashboard/archive" role="search" aria-label={`Search archived ${label.toLowerCase()}`} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="type" value={table} />
            <label className="min-w-[12rem] flex-1">
              <span className="mb-1 block text-xs font-medium text-slate-600">Search</span>
              <input type="search" name="q" defaultValue={f.q} placeholder="Name, number or reason" maxLength={80} className={`w-full placeholder:text-slate-500 ${control}`} />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Archived</span>
              <select name="when" defaultValue={f.when} className={control}>
                <option value="any">Any time</option>
                <option value="30d">Last 30 days</option>
                <option value="year">This year</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Archived by</span>
              <select name="by" defaultValue={f.by} className={control}>
                <option value="">Anyone</option>
                {people.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
                {hasSystem && <option value={SYSTEM_ACTOR}>System (data cleanup)</option>}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Sort</span>
              <select name="sort" defaultValue={f.sort} className={control}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>
            <button type="submit" className={buttonClasses("secondary")}>
              Apply
            </button>
            {filtered && (
              <a href={`/dashboard/archive?type=${table}`} className="pb-2 text-sm font-medium text-navy-700 underline underline-offset-2 hover:text-navy-900">
                Clear
              </a>
            )}
          </form>

          <p className="text-sm text-slate-600 empty:hidden" aria-live="polite">
            {archiveCountLine(label, all.length, shown.length, f)}
          </p>
        </div>

        {rows.length > 0 ? (
          <>
            {/* tablets and computers */}
            <div className="hidden md:block">
              <Table minWidth="680px">
                <THead>
                  <TH>Record</TH>
                  <TH>Why it was archived</TH>
                  <TH>Archived</TH>
                  <TH align="right">
                    <span className="sr-only">Review</span>
                  </TH>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <span className="font-medium text-slate-900">{r.title}</span>
                        {r.detail && <span className="block break-words text-xs text-slate-500">{r.detail}</span>}
                      </TD>
                      <TD className="max-w-[22rem] text-slate-700">
                        <span className="line-clamp-2 break-words" title={r.reason}>
                          {r.reason || <span className="text-slate-400">No reason written</span>}
                        </span>
                      </TD>
                      <TD className="whitespace-nowrap text-slate-700">
                        {formatDateTime(r.archivedAt)}
                        <span className="block text-xs text-slate-500">{r.archivedBy}</span>
                      </TD>
                      <TD align="right">
                        <ArchiveReview table={table} typeLabel={label} row={r} historyOnly={historyOnly} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            {/* phones: one card per record */}
            <ul className="divide-y divide-slate-100 border-t border-slate-100 md:hidden">
              {rows.map((r) => (
                <li key={r.id} className="space-y-1.5 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-medium text-slate-900">{r.title}</p>
                      {r.detail && <p className="break-words text-xs text-slate-500">{r.detail}</p>}
                    </div>
                    <div className="shrink-0">
                      <ArchiveReview table={table} typeLabel={label} row={r} historyOnly={historyOnly} />
                    </div>
                  </div>
                  {r.reason && <p className="line-clamp-3 break-words text-sm text-slate-700">{r.reason}</p>}
                  <p className="text-xs text-slate-500">
                    {formatDateTime(r.archivedAt)} · {r.archivedBy}
                  </p>
                </li>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={ARCHIVE_PAGE_SIZE}
              total={shown.length}
              basePath="/dashboard/archive"
              params={{ type: table, q: f.q || undefined, when: f.when === "any" ? undefined : f.when, by: f.by || undefined, sort: f.sort === "newest" ? undefined : f.sort }}
            />
          </>
        ) : (
          all.length === 0 && (
            <div className="border-t border-slate-100">
              <EmptyState title={`No archived ${label.toLowerCase()}.`} />
            </div>
          )
        )}
      </Card>
    </div>
  );
}
