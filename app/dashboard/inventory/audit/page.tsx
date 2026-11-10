import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/format";
import { categoryLabel } from "@/lib/appraisal/valuation";
import { Badge, Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { AuditForm } from "./audit-form";
import { MarkFoundForm } from "./mark-found-form"; // #14: "Mark found" for items missing in an audit

export const metadata = { title: "Physical audit" };

const VAULT_PAGE = 1000; // PA2: how many items one request to the database can return

// #14: the item words used in the follow-up lists ("Ring, 18K, 2 g")
type ItemInfo = { category: string; category_other: string | null; weight_grams: number; karat: number; customers?: { full_name: string } | null } | null;
const itemWords = (a: ItemInfo) => (a ? `${categoryLabel(a.category, a.category_other)}, ${a.karat}K, ${a.weight_grams} g` : "Item");

export default async function InventoryAuditPage() {
  await requireRole(["operator", "admin"]);

  const supabase = await createClient();

  // PA1 + PA2: every item that is physically in the vault: pawned, renewed, and also forfeited or queued for
  // auction (those are still on the shelf until they are sold). The database gives at most 1,000 rows per request,
  // so the list is loaded in pages of 1,000 until a page comes back short. Before, anything past 1,000 was
  // silently left out of the audit.
  type VaultRow = { id: string; status: string; vault_location: string; appraisal_items: unknown };
  const items: VaultRow[] = [];
  for (let from = 0; ; from += VAULT_PAGE) {
    const { data, error: pageError } = await supabase
      .from("inventory_items")
      .select("id, status, vault_location, appraisal_items(category, category_other, weight_grams, karat, customers(full_name))")
      .in("status", ["pawned", "extended", "forfeited", "queued_for_auction"])
      .is("archived_at", null)
      .order("vault_location")
      .order("id") // same location -> always the same order, so no item is skipped or shown twice between pages
      .range(from, from + VAULT_PAGE - 1);
    if (pageError) throw pageError;
    items.push(...((data ?? []) as VaultRow[]));
    if ((data?.length ?? 0) < VAULT_PAGE) break; // a short page = the last one
  }

  const [{ data: history }, { data: missing, count: missingTotal }, { data: found }, { data: openMissing }] = await Promise.all([
    supabase
      .from("physical_inventory_audits")
      .select("id, created_at, discrepancy_count, notes")
      .order("created_at", { ascending: false })
      .limit(5),
    // #14: lines marked missing and not followed up yet (oldest audit first). Archived audits are left out
    supabase
      .from("physical_inventory_audit_items")
      .select("id, notes, physical_inventory_audits!inner(created_at, archived_at), inventory_items(vault_location, appraisal_items(category, category_other, weight_grams, karat, customers(full_name)))", { count: "exact" }) // count = all of them, even past the 50 shown
      .eq("found", false)
      .is("resolved_at", null)
      .is("physical_inventory_audits.archived_at", null)
      .order("created_at", { referencedTable: "physical_inventory_audits", ascending: true })
      .limit(50),
    // #14: the 5 newest follow-ups, with who marked them found
    supabase
      .from("physical_inventory_audit_items")
      .select("id, resolved_at, resolution_notes, profiles(full_name), inventory_items(appraisal_items(category, category_other, weight_grams, karat))")
      .not("resolved_at", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(5),
    // PA3: every item that was missing in an audit and isn't marked found yet, with the date of that audit
    supabase
      .from("physical_inventory_audit_items")
      .select("inventory_item_id, physical_inventory_audits!inner(created_at, archived_at)")
      .eq("found", false)
      .is("resolved_at", null)
      .is("physical_inventory_audits.archived_at", null)
      .limit(1000),
  ]);

  // PA3: item -> the newest audit it was missing in
  const missingSince = new Map<string, string>();
  for (const m of (openMissing ?? []) as unknown as { inventory_item_id: string; physical_inventory_audits: { created_at: string } }[]) {
    const at = m.physical_inventory_audits.created_at;
    if (!missingSince.has(m.inventory_item_id) || at > missingSince.get(m.inventory_item_id)!) missingSince.set(m.inventory_item_id, at);
  }

  // PA4: what was missing in each of the 5 recent audits, so a row can be opened to see it
  const auditIds = (history ?? []).filter((a) => a.discrepancy_count > 0).map((a) => a.id);
  const { data: auditMissing } = auditIds.length
    ? await supabase
        .from("physical_inventory_audit_items")
        .select("id, audit_id, notes, resolved_at, inventory_items(vault_location, appraisal_items(category, category_other, weight_grams, karat, customers(full_name)))")
        .eq("found", false)
        .in("audit_id", auditIds)
        .limit(500)
    : { data: [] };
  type AuditLine = { id: string; audit_id: string; notes: string | null; resolved_at: string | null; inventory_items: { vault_location: string; appraisal_items: ItemInfo } | null };
  const linesByAudit = new Map<string, AuditLine[]>();
  for (const l of (auditMissing ?? []) as unknown as AuditLine[]) linesByAudit.set(l.audit_id, [...(linesByAudit.get(l.audit_id) ?? []), l]);

  const rows = items.map((item) => {
    const appraisal = (
      item as unknown as {
        appraisal_items: { category: string; category_other: string | null; weight_grams: number; karat: number; customers: { full_name: string } | null } | null;
      }
    ).appraisal_items;
    return {
      id: item.id,
      status: item.status,
      vault_location: item.vault_location,
      missingSince: missingSince.has(item.id) ? formatDate(missingSince.get(item.id)!) : null, // PA3
      label: `${appraisal?.customers?.full_name ?? ""}, ${appraisal ? categoryLabel(appraisal.category, appraisal.category_other) : ""}, ${appraisal?.karat}K, ${appraisal?.weight_grams} g`,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Physical audit" // B1: was "Physicalaudit" (missing space); now matches the menu and breadcrumb
        description="Walk the vault and check each item against the system. Untick anything you cannot physically find, and add a note. Forfeited items and items queued for auction are listed too: they stay in the vault until they are sold."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Inventory", href: "/dashboard/inventory" },
          { label: "Physical audit" },
        ]}
      />

      <Card padded={false}>
        {rows.length ? (
          <AuditForm items={rows} />
        ) : (
          <EmptyState icon="vault" title="Nothing to audit" description="There are no items in the vault right now." />
        )}
      </Card>

      {/* #14: items that were missing in an audit and still need a follow-up */}
      <section>
        {/* the real total; only the oldest 50 are listed */}
        <SectionTitle>Missing items to follow up ({missingTotal ?? 0}{(missingTotal ?? 0) > 50 ? ", oldest 50 shown" : ""})</SectionTitle>
        <Card padded={false}>
          {missing && missing.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {(missing as unknown as { id: string; notes: string | null; physical_inventory_audits: { created_at: string }; inventory_items: { vault_location: string; appraisal_items: ItemInfo } | null }[]).map((m) => {
                const label = itemWords(m.inventory_items?.appraisal_items ?? null);
                return (
                  <li key={m.id} className="grid gap-2 px-5 py-3 text-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                        {label} <Badge tone="danger" icon>Missing</Badge>
                      </span>
                      <span className="block text-xs text-slate-600">
                        {m.inventory_items?.appraisal_items?.customers?.full_name ?? ""} · {m.inventory_items?.vault_location} · audit of {formatDateTime(m.physical_inventory_audits.created_at)}
                      </span>
                      {m.notes && <span className="block break-words text-xs italic text-slate-600">Audit note: &ldquo;{m.notes}&rdquo;</span>}
                    </span>
                    <MarkFoundForm lineId={m.id} label={label} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon="clipboard" title="Nothing missing" description="Items you untick in an audit show here until someone marks them found." />
          )}
        </Card>
        {/* the newest follow-ups, so the Admin can see who found what */}
        {found && found.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-slate-600">
            {(found as unknown as { id: string; resolved_at: string; resolution_notes: string | null; profiles: { full_name: string } | null; inventory_items: { appraisal_items: ItemInfo } | null }[]).map((f) => (
              <li key={f.id}>
                <Badge tone="success">Found</Badge> {itemWords(f.inventory_items?.appraisal_items ?? null)} · {formatDateTime(f.resolved_at)} · {f.profiles?.full_name ?? "staff"}
                {f.resolution_notes && <span className="italic"> · &ldquo;{f.resolution_notes}&rdquo;</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>Recent audits</SectionTitle>
        <Card padded={false}>
          {history && history.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {history.map((audit) => {
                const lines = linesByAudit.get(audit.id) ?? [];
                const summary = (
                  <>
                    <span>
                      {formatDateTime(audit.created_at)}
                      {audit.notes && <span className="block text-xs text-slate-500">{audit.notes}</span>}
                    </span>
                    {audit.discrepancy_count > 0 ? (
                      <Badge tone="danger" icon>
                        {audit.discrepancy_count} discrepanc{audit.discrepancy_count === 1 ? "y" : "ies"}
                      </Badge>
                    ) : (
                      <Badge tone="success">All accounted for</Badge>
                    )}
                  </>
                );
                return (
                  <li key={audit.id} className="text-sm">
                    {lines.length ? (
                      // PA4: an audit with missing items opens to show which ones
                      <details className="group">
                        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-500 [&::-webkit-details-marker]:hidden">
                          {summary}
                          <span className="w-full text-xs font-medium text-navy-700 underline group-open:hidden">Show the missing items</span>
                        </summary>
                        <ul className="space-y-1 border-t border-slate-100 bg-slate-50 px-5 py-3 text-xs text-slate-700">
                          {lines.map((l) => (
                            <li key={l.id}>
                              <span className="font-medium text-slate-900">{itemWords(l.inventory_items?.appraisal_items ?? null)}</span> · {l.inventory_items?.appraisal_items?.customers?.full_name ?? ""} ·{" "}
                              {l.inventory_items?.vault_location} · {l.resolved_at ? `found ${formatDate(l.resolved_at)}` : "still missing"}
                              {l.notes && <span className="italic"> · &ldquo;{l.notes}&rdquo;</span>}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">{summary}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon="clipboard" title="No audits recorded yet" />
          )}
        </Card>
      </section>
    </div>
  );
}
