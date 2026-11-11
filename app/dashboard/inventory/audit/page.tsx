import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { appraisalNo } from "@/lib/ref-numbers"; // 45 -> "A-0045"
import { auditCoverage, auditProgress, followupLabel, followupStatus, reasonLabel, scopeLabel, type AuditPage, type FollowupRow } from "@/lib/inventory/audit"; // AS1: the audit rules and words
import { Alert, Badge, buttonClasses, ButtonLink, Card, cx, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { StartAuditForm } from "./start-form";
import { DiscardDraft } from "./discard-draft"; // DD1: "Discard draft" popup
import { ReviewDiscrepancy } from "./review-discrepancy"; // AD1: the "Review discrepancy" popup

export const metadata = { title: "Physical audit" };

// #14: the item words used in the follow-up lists ("Ring, 18K, 2 g · A-0045")
type ItemInfo = { appraisal_no: number | null; category: string; category_other: string | null; weight_grams: number; karat: number } | null;
const itemWords = (a: ItemInfo) => (a ? `${categoryLabel(a.category, a.category_other)}, ${a.karat}K, ${a.weight_grams} g${a.appraisal_no ? ` · ${appraisalNo(a.appraisal_no)}` : ""}` : "Item");

// AS1 (Nov 11): this page is now the START of an audit, not the audit itself.
// Before: it loaded every item in the vault into one long form with "Found" already ticked on all of them.
// Now: pick a location (or all), press Start, and the audit opens as its own saved page with 10 items at a time.
// This page only lists: audits in progress, the follow-up list, and the finished audits.
// AD1 (Nov 11): Start and In-progress sit side by side; "Mark found" became "Review discrepancy" (a popup).
export default async function InventoryAuditPage({ searchParams }: { searchParams: Promise<{ audits?: string; drafts?: string }> }) {
  const user = await requireRole(["operator", "admin"]);
  const sp = await searchParams;
  const showAll = sp.audits === "all"; // "View all" under Recent audits was pressed
  const showAllDrafts = sp.drafts === "all"; // DD1: "View all" under In-progress audits was pressed
  const DRAFTS = 3; // how many in-progress audits are listed at first, so the card doesn't keep growing
  const RECENT = 5; // how many finished audits are listed at first

  const supabase = await createClient();

  const [{ data: scopeData }, { data: openAudits }, { data: history, count: historyTotal }, { data: followData }, { data: found }, { data: overlapData }, { data: discarded }] = await Promise.all([
    // the locations that have items in the vault now, with how many (from the database, nothing typed by hand)
    supabase.rpc("audit_scope_options"),
    // audits that were started and not submitted yet
    supabase
      .from("physical_inventory_audits")
      .select("id, scope_vault, started_at, performed_by, overlap_reason, profiles!physical_inventory_audits_performed_by_fkey(full_name)")
      .eq("status", "in_progress")
      .is("archived_at", null)
      .order("started_at", { ascending: false }) // newest first
      .limit(50),
    // the newest finished audits (5, or up to 100 after "View all"), with who submitted each
    supabase
      .from("physical_inventory_audits")
      .select("id, started_at, submitted_at, created_at, discrepancy_count, notes, scope_vault, is_partial, expected_count, profiles!physical_inventory_audits_submitted_by_fkey(full_name)", { count: "exact" })
      .eq("status", "submitted")
      .is("archived_at", null)
      .order("submitted_at", { ascending: false })
      .limit(showAll ? 100 : RECENT),
    // #14 + AD1: problems from SUBMITTED audits that are not closed yet (oldest audit first), with what is needed to
    // recognise each item and every check done since. Lines of an audit still in progress are not here.
    supabase.rpc("audit_followup_list", { p_limit: 50 }),
    // the 5 newest closed follow-ups, with who closed them
    supabase
      .from("physical_inventory_audit_items")
      .select("id, resolved_at, resolution_notes, resolution_outcome, profiles!physical_inventory_audit_items_resolved_by_fkey(full_name), inventory_items(appraisal_items(appraisal_no, category, category_other, weight_grams, karat))")
      .not("resolved_at", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(5),
    // 0049: for each audit in progress, how many of its items are at each location now (to warn about overlaps by item)
    supabase.rpc("audit_open_overlaps"),
    // DD1: drafts that were discarded (kept as history; listed only after "View all")
    showAll
      ? supabase
          .from("physical_inventory_audits")
          .select("id, scope_vault, started_at, archived_at, archive_reason, expected_count, profiles!physical_inventory_audits_archived_by_fkey(full_name)")
          .eq("status", "discarded")
          .order("archived_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: null }),
  ]);
  const overlaps = (overlapData as unknown as { audit_id: string; vault: string; n: number }[] | null) ?? [];
  const follow = (followData as unknown as { total: number; rows: FollowupRow[] } | null) ?? { total: 0, rows: [] };

  const locations = ((scopeData ?? []) as { vault: string; n: number }[]).filter((l) => l.vault); // [{ vault: "Safe 1", n: 48 }, ...]
  const total = locations.reduce((sum, l) => sum + l.n, 0); // every item in the vault

  // the progress of each audit in progress (the same numbers its own page shows)
  type OpenAudit = { id: string; scope_vault: string | null; started_at: string; performed_by: string | null; overlap_reason: string | null; profiles: { full_name: string } | null };
  const open = await Promise.all(
    ((openAudits ?? []) as unknown as OpenAudit[]).map(async (a) => {
      const { data } = await supabase.rpc("audit_session_page", { p_audit: a.id, p_size: 5 }); // only the totals are used
      const counts = (data as unknown as AuditPage | null)?.counts;
      return { ...a, progress: counts ? auditProgress(counts) : null };
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Physical audit"
        description="Check the vault against the system and follow up anything that was not where it should be. Every item starts as Not checked: mark it Found only after you have seen it."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Inventory", href: "/dashboard/inventory" },
          { label: "Physical audit" },
        ]}
      />

      {/* 1 + 2. start a new audit, and continue one in progress, side by side (stacked on a phone) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="start-audit">
          <Card className="h-full">
            <h2 id="start-audit" className="text-lg font-semibold text-slate-900">
              Start or continue an audit
            </h2>
            <p className="mb-3 mt-0.5 text-sm text-slate-600">Pick a location. One location has one audit at a time: if it is already in progress you continue that one. Forfeited items and items queued for auction are included: they stay in the vault until they are sold.</p>
            {total > 0 ? (
              <StartAuditForm
                locations={locations}
                total={total}
                open={open.map((a) => ({ id: a.id, scope: a.scope_vault ?? "", checked: a.progress?.checked ?? 0, total: a.progress?.total ?? 0, startedBy: a.profiles?.full_name ?? null, shared: Object.fromEntries(overlaps.filter((o) => o.audit_id === a.id).map((o) => [o.vault, o.n])) }))}
              />
            ) : (
              <p className="text-sm text-slate-600">There are no items in the vault right now, so there is nothing to audit.</p>
            )}
          </Card>
        </section>

        <section aria-labelledby="open-audits">
          <Card padded={false} className="h-full">
            <div className="px-5 pt-5">
              <h2 id="open-audits" className="text-lg font-semibold text-slate-900">
                In-progress audits{open.length > 0 ? ` (${open.length})` : ""}
              </h2>
              <p className="mt-0.5 text-sm text-slate-600">Continue a check that was started and not submitted yet.</p>
            </div>
            {open.length > 0 ? (
              <ul className="mt-2 divide-y divide-slate-100">
                {(showAllDrafts ? open : open.slice(0, DRAFTS)).map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                        {scopeLabel(a.scope_vault)}
                        {/* the audit's short id: the first 8 characters of its database id */}
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-medium text-slate-700">{a.id.slice(0, 8)}</span>
                      </span>
                      <span className="block text-xs text-slate-600">
                        Started {formatDateTime(a.started_at)}
                        {a.profiles?.full_name ? ` by ${a.profiles.full_name}` : ""}
                      </span>
                      {/* 0049: started on purpose while another audit listed some of the same items */}
                      {a.overlap_reason && <span className="block break-words text-xs text-amber-900">Separate audit (overlaps another): &ldquo;{a.overlap_reason}&rdquo;</span>}
                      {a.progress && (
                        <span className="block text-xs text-slate-700">
                          {a.progress.checked.toLocaleString("en-PH")} checked · {(a.progress.total - a.progress.checked).toLocaleString("en-PH")} left
                        </span>
                      )}
                    </span>
                    {/* gap-4 on touch sizes keeps Discard and Continue apart; each is 40px tall there */}
                    <span className="flex flex-wrap items-center gap-4 lg:gap-2">
                      {/* DD1: only the person who started the draft, or an Admin (the database checks it again) */}
                      {(user.profile.role === "admin" || a.performed_by === user.id) && (
                        <DiscardDraft auditId={a.id} location={scopeLabel(a.scope_vault)} checked={a.progress?.checked ?? 0} total={a.progress?.total ?? 0} />
                      )}
                      {/* Continue only opens the audit that exists; it never makes a new one */}
                      <Link href={`/dashboard/inventory/audit/${a.id}`} aria-label={`Continue the audit of ${scopeLabel(a.scope_vault)}`} className={cx(buttonClasses("primary", "sm"), "min-h-10 lg:min-h-0")}>
                        Continue
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 pb-5 pt-3 text-sm text-slate-600">No audit is in progress.</p>
            )}
            {/* DD1: the list shows 3 at first */}
            {open.length > DRAFTS && (
              <p className="border-t border-slate-100 px-5 py-2 text-sm">
                {showAllDrafts ? (
                  <Link href="/dashboard/inventory/audit" className="font-medium text-navy-700 underline">Show the newest {DRAFTS}</Link>
                ) : (
                  <Link href="/dashboard/inventory/audit?drafts=all" className="font-medium text-navy-700 underline">View all ({open.length})</Link>
                )}
              </p>
            )}
          </Card>
        </section>
      </div>

      {/* 3. #14 + AD1: problems from finished audits that are not closed yet */}
      <section>
        <SectionTitle
          description="The finding is what the audit recorded and never changes. The status is where the follow-up stands now."
          actions={follow.total > 0 ? <Badge tone="danger" icon>{follow.total} unresolved</Badge> : <Badge tone="success">None unresolved</Badge>}
        >
          Items to follow up
        </SectionTitle>
        <Card padded={false}>
          {follow.rows.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {follow.rows.map((m) => {
                const status = followupStatus(m.followups, m.result); // Pending verification / Under investigation / Escalated
                const last = m.followups[m.followups.length - 1]; // the newest check, if any
                return (
                  <li key={m.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-3 text-sm">
                    <span className="min-w-0 flex-1 basis-72">
                      <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                        {itemWords({ appraisal_no: m.appraisal_no, category: m.category ?? "", category_other: m.category_other, weight_grams: m.weight_grams ?? 0, karat: m.karat ?? 0 })}
                      </span>
                      <span className="block text-xs text-slate-600">
                        {m.customer_name ?? ""} · {m.expected_vault} · audit of {formatDateTime(m.audit_at)}
                      </span>
                      <span className="mt-1 block break-words text-xs text-slate-700">
                        Finding: {m.result === "found_elsewhere" ? `found elsewhere${m.found_location ? ` (${m.found_location})` : ""}` : `not located${m.reason ? `, ${reasonLabel(m.reason).toLowerCase()}` : ""}`}
                        {m.notes && <span className="italic"> · &ldquo;{m.notes}&rdquo;</span>}
                      </span>
                      {last && (
                        <span className="block break-words text-xs text-slate-700">
                          Last check: {followupLabel(last.outcome).toLowerCase()} · {formatDateTime(last.at)} · {last.by ?? "staff"}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {m.result === "found_elsewhere" ? <Badge tone="warning">Found elsewhere</Badge> : <Badge tone="danger" icon>Not located</Badge>}
                      <Badge tone={status.tone} icon={status.tone === "danger"}>{status.label}</Badge>
                      <ReviewDiscrepancy row={m} />
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon="clipboard" title="Nothing to follow up" description="Items marked Not located or Found elsewhere in a submitted audit show here until someone finds them." />
          )}
          {follow.total > follow.rows.length && <p className="border-t border-slate-100 px-5 py-2 text-xs text-slate-600">Showing the oldest {follow.rows.length} of {follow.total}.</p>}
        </Card>
        {/* the newest closed follow-ups, so the Admin can see who did what */}
        {found && found.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-slate-600">
            {(found as unknown as { id: string; resolved_at: string; resolution_notes: string | null; resolution_outcome: string | null; profiles: { full_name: string } | null; inventory_items: { appraisal_items: ItemInfo } | null }[]).map((f) => (
              <li key={f.id}>
                <Badge tone="success">Resolved</Badge> {itemWords(f.inventory_items?.appraisal_items ?? null)} · {followupLabel(f.resolution_outcome ?? "found_expected").toLowerCase()} · {formatDateTime(f.resolved_at)} · {f.profiles?.full_name ?? "staff"}
                {f.resolution_notes && <span className="italic"> · &ldquo;{f.resolution_notes}&rdquo;</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4. finished audits: open one to see every item and its result (read only) */}
      <section>
        <SectionTitle
          actions={
            (historyTotal ?? 0) > RECENT ? (
              showAll ? (
                <Link href="/dashboard/inventory/audit" className="text-sm font-medium text-navy-700 underline">Show the newest {RECENT}</Link>
              ) : (
                <Link href="/dashboard/inventory/audit?audits=all" className="text-sm font-medium text-navy-700 underline">View all ({historyTotal})</Link>
              )
            ) : undefined
          }
        >
          {showAll ? "All audits" : "Recent audits"}
        </SectionTitle>
        <Card padded={false}>
          {history && history.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {history.map((audit) => (
                <li key={audit.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                      {formatDateTime(audit.submitted_at ?? audit.created_at)}
                      {/* AV1: how much of ITS list was checked. Not "Full": a short list fully checked is not a whole-vault count */}
                      {audit.is_partial ? <Badge tone="warning">Partial</Badge> : <Badge tone="neutral">All listed items checked</Badge>}
                      {audit.discrepancy_count > 0 ? (
                        <Badge tone="danger" icon>
                          {audit.discrepancy_count} {audit.discrepancy_count === 1 ? "discrepancy" : "discrepancies"}
                        </Badge>
                      ) : (
                        <Badge tone="success">No discrepancies</Badge>
                      )}
                    </span>
                    <span className="block text-xs text-slate-600">
                      {auditCoverage({ ...audit, started_at: audit.started_at, submitted_at: audit.submitted_at }).scope}
                      {(audit as unknown as { profiles: { full_name: string } | null }).profiles?.full_name ? ` · by ${(audit as unknown as { profiles: { full_name: string } | null }).profiles!.full_name}` : ""}
                      {audit.notes ? ` · ${audit.notes}` : ""}
                    </span>
                  </span>
                  <ButtonLink href={`/dashboard/inventory/audit/${audit.id}`} variant="secondary" size="sm">
                    View
                  </ButtonLink>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="clipboard" title="No audits recorded yet" />
          )}
        </Card>
      </section>

      {/* DD1: discarded drafts stay as history (not deleted). Shown after "View all"; each opens read only */}
      {showAll && discarded && discarded.length > 0 && (
        <section>
          <SectionTitle description="Drafts that were thrown away. They are kept with their checks, who discarded them and why.">Discarded drafts ({discarded.length})</SectionTitle>
          <Card padded={false}>
            <ul className="divide-y divide-slate-100">
              {(discarded as unknown as { id: string; scope_vault: string | null; started_at: string; archived_at: string | null; archive_reason: string | null; expected_count: number | null; profiles: { full_name: string } | null }[]).map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                      {scopeLabel(d.scope_vault)} <Badge tone="neutral">Discarded</Badge>
                    </span>
                    <span className="block break-words text-xs text-slate-600">
                      Started {formatDateTime(d.started_at)}
                      {d.archived_at ? ` · discarded ${formatDateTime(d.archived_at)}` : ""}
                      {d.profiles?.full_name ? ` by ${d.profiles.full_name}` : ""}
                      {d.archive_reason ? ` · ${d.archive_reason}` : ""}
                    </span>
                  </span>
                  <ButtonLink href={`/dashboard/inventory/audit/${d.id}`} variant="secondary" size="sm">
                    View
                  </ButtonLink>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {/* shown only when the lists could not be read (should not happen for an Operator or Admin) */}
      {!scopeData && <Alert tone="warning">The vault locations could not be loaded. Reload the page.</Alert>}
    </div>
  );
}
