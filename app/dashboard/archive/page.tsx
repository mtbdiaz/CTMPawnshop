import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { ARCHIVABLE_TABLES, ARCHIVE_LABELS, type ArchivableTable } from "@/lib/archive";
import { formatDateTime } from "@/lib/format";
import { Card, EmptyState, FilterTabs, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { RestoreButton } from "@/components/archive-controls";

export const metadata = { title: "Archive" };

type Row = { id: string; archived_at: string; archive_reason: string | null; archived_by: string | null; summary: string };

const SUMMARY_COLUMNS: Record<ArchivableTable, string> = {
  customers: "full_name, contact_number",
  appraisal_items: "category, karat, weight_grams",
  loans: "ticket_number, status",
  loan_payments: "receipt_number, amount",
  loan_extensions: "new_maturity_date, extension_type",
  inventory_items: "vault_location, status",
  cash_flow_entries: "entry_type, amount, description",
  auction_batches: "notes",
  physical_inventory_audits: "notes, discrepancy_count",
  suspicious_activity_flags: "reason, status",
  reminder_log: "loan_id",
};

function summarize(table: ArchivableTable, r: Record<string, unknown>): string {
  switch (table) {
    case "customers":
      return `${r.full_name} (${r.contact_number})`;
    case "appraisal_items":
      return `${r.weight_grams} g, ${r.karat}K ${String(r.category).replace(/_/g, " ")}`;
    case "loans":
      return `${r.ticket_number} (${r.status})`;
    case "loan_payments":
      return `${r.receipt_number}: ₱${r.amount}`;
    case "cash_flow_entries":
      return `${String(r.entry_type).replace(/_/g, " ")}: ₱${r.amount} ${r.description ?? ""}`;
    default:
      return Object.values(r).filter((v) => v !== null && typeof v !== "object").slice(0, 3).join(", ");
  }
}

// Item 1: Admin-only view of everything archived, with restore.
export default async function ArchivePage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requireRole(["admin"]);
  const requested = (await searchParams).type;
  const table: ArchivableTable = (ARCHIVABLE_TABLES as readonly string[]).includes(requested ?? "") ? (requested as ArchivableTable) : "customers";

  const supabase = await createClient();
  const [{ data, error }, { data: staff }] = await Promise.all([
    supabase
      .from(table)
      .select(`id, archived_at, archive_reason, archived_by, ${SUMMARY_COLUMNS[table]}`)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .limit(200),
    supabase.from("profiles").select("id, full_name"),
  ]);
  if (error) throw error;
  const names = new Map((staff ?? []).map((p) => [p.id, p.full_name]));
  const rows: Row[] = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    archived_at: String(r.archived_at),
    archive_reason: (r.archive_reason as string | null) ?? null,
    archived_by: (r.archived_by as string | null) ?? null,
    summary: summarize(table, r),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Archive"
        description="Archived records are hidden from lists and counts but never deleted. Restoring puts them back."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Archive" }]}
      />
      <FilterTabs
        current={table}
        tabs={ARCHIVABLE_TABLES.map((t) => ({ label: ARCHIVE_LABELS[t], value: t, href: `/dashboard/archive?type=${t}` }))}
      />
      <Card padded={false}>
        {rows.length ? (
          <Table minWidth="720px">
            <THead>
              <TH>Record</TH>
              <TH>Reason</TH>
              <TH>Archived</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>{r.summary}</TD>
                  <TD className="text-slate-600">{r.archive_reason ?? ""}</TD>
                  <TD className="whitespace-nowrap text-slate-600">
                    {formatDateTime(r.archived_at)}
                    <span className="block text-xs">{r.archived_by ? (names.get(r.archived_by) ?? "Unknown user") : ""}</span>
                  </TD>
                  <TD align="right">
                    <RestoreButton table={table} id={r.id} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState title={`No archived ${ARCHIVE_LABELS[table].toLowerCase()}.`} />
        )}
      </Card>
    </div>
  );
}
