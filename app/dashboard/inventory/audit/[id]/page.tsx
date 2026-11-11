import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { pageParam, PageHeader } from "@/components/ui";
import { auditPageSize, auditView, scopeLabel, type AuditPage, type Followup } from "@/lib/inventory/audit"; // AS1: the audit rules and words
import { AuditSession } from "./audit-session";

export const metadata = { title: "Physical audit" };

// AS1 (Nov 11): ONE audit, as its own page. It works for an audit in progress (the checklist) and for a submitted
// one (read only). The address keeps the view, search, location and page, so a refresh or the Back button
// lands on the same place, and every result is already saved in the database.
export default async function AuditSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; q?: string; vault?: string; page?: string; size?: string }>;
}) {
  const user = await requireRole(["operator", "admin"]);
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound(); // not an id: no such audit

  const view = auditView(sp.view); // which tab (anything unknown = All)
  const q = (sp.q ?? "").trim().slice(0, 80); // the search text
  const vault = (sp.vault ?? "").trim().slice(0, 120); // one location inside the audit, or "" for all of it
  const page = pageParam(sp.page);
  const size = auditPageSize(sp.size); // 10 (default), 25 or 50 rows

  // one database call: the audit, the totals of the WHOLE audit, and only the rows of this page.
  // The search and the filters run in the database, so the browser never gets a hidden list of hundreds of items.
  const supabase = await createClient();
  const { data: raw, error } = await supabase.rpc("audit_session_page", {
    p_audit: id,
    p_view: view,
    p_q: q || undefined,
    p_vault: vault || undefined,
    p_page: page,
    p_size: size,
  });
  if (error || !raw) notFound(); // no such audit (or it was discarded)
  const data = raw as unknown as AuditPage;

  const base = `/dashboard/inventory/audit/${id}`;
  // a page past the end (the list got shorter because items were checked): go to the last page that has rows
  if (data.rows.length === 0 && data.total > 0 && page > 1) {
    const qs = new URLSearchParams();
    if (view !== "all") qs.set("view", view);
    if (q) qs.set("q", q);
    if (vault) qs.set("vault", vault);
    if (size !== 10) qs.set("size", String(size));
    const last = Math.ceil(data.total / size);
    if (last > 1) qs.set("page", String(last));
    redirect(qs.toString() ? `${base}?${qs}` : base);
  }

  // DD1: a draft can be discarded by the person who started it, or by an Admin (the database checks it again)
  const { data: owner } = await supabase
    .from("physical_inventory_audits")
    .select("performed_by, overlap_reason, archived_at, archive_reason, profiles!physical_inventory_audits_archived_by_fkey(full_name)")
    .eq("id", id)
    .maybeSingle();
  const canDiscard = user.profile.role === "admin" || owner?.performed_by === user.id;
  // extra words for the top card: why it was started as a separate audit (0049), and who discarded it and why
  const extra = {
    overlapReason: owner?.overlap_reason ?? null,
    discardedAt: owner?.archived_at ?? null,
    discardedBy: (owner as unknown as { profiles: { full_name: string } | null } | null)?.profiles?.full_name ?? null,
    discardReason: owner?.archive_reason ?? null,
  };

  // AD1: for a submitted audit, the checks done AFTER it (follow-ups). They are shown apart from the audit's own
  // results, which stay as they were recorded that day.
  let followups: Followup[] = [];
  if (data.audit.status === "submitted") {
    const { data: fu } = await supabase.rpc("audit_followups_for", { p_audit: id });
    followups = (fu as unknown as Followup[] | null) ?? [];
  }

  // when this changes, the checklist starts again from the fresh data (a new page, a new filter, or someone else's save)
  const stamp = [data.audit.status, followups.length, view, q, vault, page, size, ...data.rows.map((r) => `${r.id}:${r.version}`)].join("|");

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Physical audit: ${scopeLabel(data.audit.scope_vault)}`}
        description={
          data.audit.status === "in_progress"
            ? "Find each item, then pick its result. Every result is saved right away, so you can stop and continue later."
            : (data.audit.status as string) === "discarded"
              ? "This draft was discarded. It is kept as it was, for the record, and can't be changed."
              : "This audit is submitted. It is kept as it was and can't be changed."
        }
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Inventory", href: "/dashboard/inventory" },
          { label: "Physical audit", href: "/dashboard/inventory/audit" },
          { label: scopeLabel(data.audit.scope_vault) },
        ]}
      />
      <AuditSession key={stamp} data={data} base={base} view={view} q={q} vault={vault} followups={followups} canDiscard={canDiscard} extra={extra} />
    </div>
  );
}
